"""FastAPI application factory."""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app import __version__
from app.api.routers import disputes, evidence, health, reporting, sandbox, telemetry, webhooks
from app.config import Settings, get_settings
from app.db.session import Database
from app.errors import VerdictPayError
from app.integrations.llm.factory import build_narrative_provider
from app.integrations.paypal.factory import build_gateway
from app.integrations.search.factory import build_search_index
from app.logging_setup import configure_logging, get_logger, log_context
from app.security import SlidingWindowLimiter
from app.services.bootstrap import ensure_demo_merchant, restore_gateway_state

logger = get_logger("verdictpay.api")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Adds a request id, enforces the body cap and logs one line per request."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings: Settings = request.app.state.settings
        request_id = request.headers.get(settings.request_id_header) or uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()

        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers[settings.request_id_header] = request_id
        logger.info(
            "request",
            extra=log_context(
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=round(elapsed_ms, 2),
            ),
        )
        return response


class BodySizeLimitMiddleware:
    """ASGI-level request body cap that counts real bytes.

    Checking Content-Length alone is bypassable with Transfer-Encoding: chunked,
    so the middleware buffers the stream (bounded by max_bytes + 1) and replays it
    to the application. This runs before auth, routing and rate limiting.
    """

    def __init__(
        self, app: Any, *, max_bytes: int, request_id_header: str = "X-Request-Id"
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.request_id_header = request_id_header

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        raw_headers = {key.lower(): value for key, value in scope.get("headers", [])}
        declared = raw_headers.get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > self.max_bytes:
                    await self._reject(scope, send)
                    return
            except ValueError:
                pass

        # Requests with a declared length (or no body at all) keep the original
        # receive stream: streaming responses listen on it for client disconnects,
        # and buffering would make that listener fire immediately.
        if declared is not None or scope.get("method", "").upper() in {"GET", "HEAD", "OPTIONS"}:
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        total = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            total += len(chunk)
            if total > self.max_bytes:
                await self._reject(scope, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        body = b"".join(chunks)
        replayed = False

        async def replay() -> dict[str, Any]:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        await self.app(scope, replay, send)

    async def _reject(self, scope: dict[str, Any], send: Any) -> None:
        raw_headers = {key.lower(): value for key, value in scope.get("headers", [])}
        request_id = raw_headers.get(self.request_id_header.lower(), b"").decode("latin-1")
        response = JSONResponse(
            status_code=413,
            content={
                "error": {
                    "code": "payload_too_large",
                    "message": f"Body exceeds {self.max_bytes} bytes.",
                    "details": [],
                    "request_id": request_id or None,
                }
            },
            headers={self.request_id_header: request_id} if request_id else {},
        )
        await response(scope, receive=self._empty_receive, send=send)

    @staticmethod
    async def _empty_receive() -> dict[str, Any]:
        return {"type": "http.disconnect"}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-credential request budget with a 429 envelope and Retry-After.

    Keyed by API key when present, otherwise by client address. Health checks are
    exempt so container orchestrators never trip the limiter.
    """

    def __init__(self, app: object, *, limit: int, window_seconds: float = 60.0) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.limiter = SlidingWindowLimiter(limit=limit, window_seconds=window_seconds)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path.endswith("/health"):
            return await call_next(request)

        key = request.headers.get("X-API-Key") or (
            request.client.host if request.client else "anonymous"
        )
        allowed, remaining = self.limiter.check(key)
        if not allowed:
            settings: Settings = request.app.state.settings
            request_id = getattr(request.state, "request_id", None)
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "code": "rate_limited",
                        "message": "Too many requests. Retry after 60 seconds.",
                        "details": [],
                        "request_id": request_id,
                    }
                },
                headers={
                    "Retry-After": "60",
                    settings.request_id_header: request_id or "",
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    configure_logging(settings.log_level)
    database = Database(settings.database_url)
    await database.create_all()
    async with database.session() as session:
        await ensure_demo_merchant(session, settings)

    app.state.db = database
    app.state.gateway = build_gateway(settings)
    app.state.narrative = build_narrative_provider(settings)
    app.state.search = build_search_index(settings)
    async with database.session() as session:
        await restore_gateway_state(session, app.state.gateway)
    app.state.started_at = time.monotonic()
    logger.info("startup", extra=log_context(**settings.describe()))
    try:
        yield
    finally:
        await app.state.gateway.close()
        await app.state.search.close()
        await database.dispose()
        logger.info("shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="VerdictPay API",
        version=__version__,
        description=(
            "Pre-dispute telemetry, deterministic PayPal dispute EV triage, and "
            "seller-protection evidence defense."
        ),
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )
    app.state.settings = settings

    app.add_middleware(
        BodySizeLimitMiddleware,
        max_bytes=settings.max_body_bytes,
        request_id_header=settings.request_id_header,
    )
    app.add_middleware(
        RateLimitMiddleware,
        limit=settings.rate_limit_per_minute,
        window_seconds=60.0,
    )
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[settings.request_id_header],
    )

    prefix = settings.api_v1_prefix
    for module in (health, telemetry, sandbox, disputes, evidence, webhooks, reporting):
        app.include_router(module.router, prefix=prefix)

    @app.exception_handler(VerdictPayError)
    async def _domain_error(request: Request, exc: VerdictPayError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        if exc.status_code >= 500:
            logger.error(
                "domain_error",
                extra=log_context(code=exc.code, message=exc.message, request_id=request_id),
            )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                    "request_id": request_id,
                }
            },
            headers={settings.request_id_header: request_id or ""},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        details = [
            {
                "field": ".".join(str(part) for part in error.get("loc", [])),
                "message": error.get("msg", "Invalid value."),
                "code": error.get("type"),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Request validation failed.",
                    "details": details,
                    "request_id": request_id,
                }
            },
            headers={settings.request_id_header: request_id or ""},
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.exception("unhandled_error", extra=log_context(request_id=request_id))
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected error occurred.",
                    "details": [],
                    "request_id": request_id,
                }
            },
            headers={settings.request_id_header: request_id or ""},
        )

    return app


app = create_app()
