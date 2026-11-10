/**
 * /veto-lab end to end in a real browser against the live stack: the three negative
 * controls run, each unguarded proposal is vetoed with EXIT CODE 2 and each hardened
 * alternative executes with EXIT CODE 0, and the console stays clean.
 */
import { expect, test } from "@playwright/test";

test("veto lab runs three controls with veto and executed provenance", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/veto-lab");
  await page.getByTestId("run-veto-lab").click();

  for (const id of ["control-naive", "control-toolkit", "control-llm"]) {
    await expect(page.getByTestId(id)).toBeVisible({ timeout: 60_000 });
  }
  const vetoes = page.getByTestId("verdict-veto");
  const allows = page.getByTestId("verdict-allow");
  // naive: 2 vetoes + 2 hardened allows; toolkit: 3 vetoes; llm: 1 veto + 1 allow.
  await expect(vetoes).toHaveCount(6);
  await expect(allows).toHaveCount(3);
  await expect(page.getByText("EXIT CODE 2 — VETO").first()).toBeVisible();
  await expect(page.getByText("EXIT CODE 0 — EXECUTED").first()).toBeVisible();
  for (const code of [
    "VETO_HVD_CLIFF_BREACH",
    "VETO_VAMP_CLIFF_BREACH",
    "VETO_TOOLKIT_ACL_BYPASS",
    "VETO_PATH_TRAVERSAL_BLOCKED",
    "VETO_PROMPT_INJECTION_BLOCKED",
    "VETO_CE3_WINDOW_OUT_OF_RANGE",
  ]) {
    await expect(page.getByText(code).first()).toBeVisible();
  }
  await expect(page.getByText("[VISA-TC40 / ACQUIRER-FEED SIMULATION]").first()).toBeVisible();
  await expect(page.getByText("[LIVE PAYPAL SANDBOX]").first()).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
