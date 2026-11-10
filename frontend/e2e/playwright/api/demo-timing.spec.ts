/**
 * The judge story must fit a <180 s video: checkout, telemetry, dispute + triage,
 * AI analysis, dossier and the Veto Lab complete inside that budget against the
 * real sandbox stack.
 */
import { expect, test } from "@playwright/test";

import { API_BASE, AUTH_HEADERS, assertStackReachable, postJson, runJudgeFlow } from "../support";

test("judge flow plus veto lab completes in under 180 seconds", async ({ request }) => {
  test.setTimeout(200_000);
  await assertStackReachable(request);
  const started = Date.now();
  const run = await runJudgeFlow(request);
  const ai = await postJson(request, `/disputes/${run.disputeId}/ai/analyze`, {});
  expect(ai.status).toBe(200);
  const dossier = await request.get(`${API_BASE}/api/v1/disputes/${run.disputeId}/dossier.pdf`, {
    headers: AUTH_HEADERS,
  });
  expect(dossier.status()).toBe(200);
  const lab = await postJson(request, "/veto-lab/run", {});
  expect(lab.status).toBe(200);
  expect((lab.body as { controls: unknown[] }).controls).toHaveLength(3);
  const elapsed = (Date.now() - started) / 1000;
  test.info().annotations.push({ type: "elapsed_s", description: elapsed.toFixed(1) });
  expect(elapsed).toBeLessThan(180);
});
