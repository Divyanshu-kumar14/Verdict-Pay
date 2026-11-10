/**
 * Negative control 2 — live reproduction of @paypal/agent-toolkit dispute hazards.
 *
 * Runs the real published toolkit code (version pinned in package.json) with
 * axios' adapter replaced by a recorder, so nothing reaches PayPal: every
 * request the toolkit *would* send is captured and reported.
 *
 *   cd tools/toolkit-probe && npm install && node toolkit_audit_probe.ts [out.json]
 *
 * Hazards checked:
 *   1. ACL bypass: getTools() hides disabled tools, handleToolCall() runs them anyway
 *   2. path traversal: dispute_id is interpolated into the URL unescaped
 *   3. query leakage: '?' / '&' in dispute_id becomes URL query parameters
 *   4. three dispute tools only (no make-offer / provide-evidence / escalate / appeal)
 *   5. stale OAuth: the access token is cached forever (expires_in is ignored)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// The toolkit is CommonJS and require()s axios; patch that exact instance.
const require = createRequire(import.meta.url);
const axios = require("axios");
const { PayPalAgentToolkit, ALL_TOOLS_ENABLED } = require("@paypal/agent-toolkit/openai");

import { CliffGuardToolkitShield, type ToolCall } from "./CliffGuardToolkitShield.ts";

type Captured = { method: string; url: string };
const captured: Captured[] = [];
let lastContent = "";
let oauthCalls = 0;

axios.defaults.adapter = async (config: { url?: string; method?: string }) => {
  const url = String(config.url ?? "");
  captured.push({ method: String(config.method ?? "get").toUpperCase(), url });
  if (url.endsWith("/v1/oauth2/token")) {
    oauthCalls += 1;
    // expires_in: 1 second. A correct client refreshes; the toolkit never does.
    return { data: { access_token: `probe-token-${oauthCalls}`, expires_in: 1 }, status: 200,
      statusText: "OK", headers: {}, config };
  }
  return { data: { probe: true }, status: 200, statusText: "OK", headers: {}, config };
};

const pkgPath = new URL("./node_modules/@paypal/agent-toolkit/package.json", import.meta.url);
const toolkitVersion = JSON.parse(readFileSync(pkgPath, "utf8")).version as string;

// Only list_disputes is enabled; accept_dispute_claim is deliberately NOT allowed.
const configuration = { actions: { disputes: { list: true } }, context: { sandbox: true } };
const toolkit = new PayPalAgentToolkit({
  clientId: "probe-client-id",
  clientSecret: "probe-client-secret",
  configuration,
});
const exposed = toolkit.getTools().map((tool: { function: { name: string } }) => tool.function.name);
const shield = new CliffGuardToolkitShield(toolkit, exposed);

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: `call-${name}`,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

async function unguarded(toolCall: ToolCall): Promise<Captured | null> {
  const before = captured.length;
  const response = await toolkit.handleToolCall(toolCall as never);
  lastContent = String((response as { content?: unknown }).content ?? "");
  const sent = captured.slice(before).filter((item) => !item.url.endsWith("/oauth2/token"));
  return sent.at(-1) ?? null;
}

const cases = [
  {
    id: "acl_bypass",
    title: "Disabled tool executed through handleToolCall()",
    call: call("accept_dispute_claim", { dispute_id: "PP-D-1", note: "accepted" }),
  },
  {
    id: "path_traversal",
    title: "dispute_id '../' rewrites the PayPal URL",
    call: call("accept_dispute_claim", { dispute_id: "../../v1/vault/payment-tokens", note: "x" }),
  },
  {
    id: "query_leakage",
    title: "dispute_id '?' / '&' injects query parameters",
    call: call("get_dispute", { dispute_id: "PP-D-1?fields=all&page_size=500" }),
  },
];

const results = [];
for (const item of cases) {
  const sent = await unguarded(item.call);
  const verdict = shield.inspect(item.call);
  results.push({
    id: item.id,
    title: item.title,
    tool: item.call.function.name,
    arguments: JSON.parse(item.call.function.arguments),
    unguarded: { exit_code: 0, executed: sent !== null, request: sent, toolkit_output: lastContent.slice(0, 200) },
    shielded: verdict,
  });
}

// Stale OAuth: wait past expires_in and call again; count token fetches.
await new Promise((resolve) => setTimeout(resolve, 1200));
await unguarded(call("list_disputes", {}));
const disputeTools = ALL_TOOLS_ENABLED as Record<string, unknown>;

const report = {
  generated_at: new Date().toISOString(),
  toolkit: `@paypal/agent-toolkit@${toolkitVersion}`,
  network: "none (axios adapter recorder; no request left this process)",
  exposed_tools: exposed,
  results,
  three_action_limit: {
    dispute_tools: ["list_disputes", "get_dispute", "accept_dispute_claim"],
    missing: ["make-offer", "provide-evidence", "send-message", "escalate", "appeal"],
    all_tools_enabled_keys: Object.keys(disputeTools ?? {}),
  },
  stale_oauth: {
    token_expires_in_seconds: 1,
    oauth_requests_after_expiry: oauthCalls,
    refreshed: oauthCalls > 1,
  },
};

const out = process.argv[2];
const text = JSON.stringify(report, null, 2);
if (out) writeFileSync(out, text + "\n");
console.log(text);
