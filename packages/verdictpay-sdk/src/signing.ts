/**
 * Request signing.
 *
 * The server verifies hex(HMAC-SHA256(secret, "<unixSeconds>.<exactBody>")).
 * This is the same rule as backend/app/security.py::compute_signature.
 * WebCrypto is used so the SDK also runs unchanged in browsers and edge runtimes.
 */

import { VerdictPayError } from "./errors";

const encoder = new TextEncoder();

/** Lowercase hex encoding of a byte array. */
function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Signs the exact request body with the shared secret.
 *
 * @param secret Shared HMAC secret.
 * @param timestamp Unix timestamp in seconds, as a string.
 * @param body Exact JSON body string that will be put on the wire.
 * @returns Lowercase hex HMAC-SHA256 digest.
 */
export async function signPayload(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new VerdictPayError(
      "invalid_config",
      "WebCrypto is unavailable; @verdictpay/sdk requires Node 20+ or a browser runtime.",
    );
  }
  const key = await subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await subtle.sign("HMAC", key, encoder.encode(timestamp + "." + body));
  return toHex(new Uint8Array(digest));
}

/** Current Unix time in whole seconds, as the X-VerdictPay-Timestamp header wants it. */
export function unixTimestamp(now: number = Date.now()): string {
  return Math.floor(now / 1000).toString();
}
