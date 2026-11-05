# syntax=docker/dockerfile:1.7
# VerdictPay command center image. Build from the repository root:
#   docker build -f frontend/Dockerfile -t verdictpay/web .
#
# NEXT_PUBLIC_* values are inlined by Next.js at build time, so they are build args.
#
# The app depends on the sibling package @verdictpay/sdk through a file: path
# ("../packages/verdictpay-sdk"). That package exports ./dist/index.js and dist/
# is gitignored, so the SDK must be installed AND BUILT inside the image before
# the frontend installs, and its source tree must sit at the same absolute path
# the symlink expects, in every stage that resolves the dependency. Skipping this
# is what made the earlier image fail with:
#   ENOENT: no such file or directory, scandir '/packages/verdictpay-sdk'

FROM node:22-alpine AS sdk
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /packages/verdictpay-sdk
COPY packages/verdictpay-sdk/package.json packages/verdictpay-sdk/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY packages/verdictpay-sdk/ ./
RUN pnpm build


FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app
# The file: dependency must resolve during install, so the built SDK is present.
COPY --from=sdk /packages/verdictpay-sdk /packages/verdictpay-sdk
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ARG NEXT_PUBLIC_VERDICTPAY_API_KEY=vp_demo_sk_local
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_VERDICTPAY_API_KEY=${NEXT_PUBLIC_VERDICTPAY_API_KEY}

COPY --from=deps /app/node_modules ./node_modules
# Keep the symlink target alive in the build stage too.
COPY --from=sdk /packages/verdictpay-sdk /packages/verdictpay-sdk
COPY frontend/ ./
# The repo may not ship a public/ directory; create it so the runtime COPY is deterministic.
RUN mkdir -p public && pnpm build


FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# node_modules links @verdictpay/sdk to this path; without it the link dangles.
COPY --from=sdk --chown=nextjs:nodejs /packages/verdictpay-sdk /packages/verdictpay-sdk

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
