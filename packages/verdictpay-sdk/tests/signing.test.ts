import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { signPayload, unixTimestamp } from "../src/signing";

describe("signPayload", () => {
  it("matches the backend compute_signature rule", async () => {
    const secret = "dev-signing-secret-change-me";
    const timestamp = "1700000000";
    const body = '{"events":[]}';

    const expected = createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");

    await expect(signPayload(secret, timestamp, body)).resolves.toBe(expected);
  });

  it("returns the documented lowercase hex digest for a fixed vector", async () => {
    await expect(signPayload("test-secret", "1700000000", '{"events":[]}')).resolves.toBe(
      "701cff562429740008efe21fbe67b094cde993ac4e1efd061122119d53a6d2c9",
    );
  });

  it("changes when the body changes", async () => {
    const first = await signPayload("test-secret", "1700000000", '{"events":[]}');
    const second = await signPayload("test-secret", "1700000000", '{"events":[{}]}');

    expect(second).not.toBe(first);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("unixTimestamp", () => {
  it("truncates milliseconds to whole seconds", () => {
    expect(unixTimestamp(1_700_000_000_999)).toBe("1700000000");
    expect(unixTimestamp(1_700_000_001_000)).toBe("1700000001");
  });
});
