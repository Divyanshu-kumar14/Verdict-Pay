/**
 * CliffGuardToolkitShield — a guard in front of PayPalAgentToolkit.handleToolCall.
 *
 * The published toolkit (@paypal/agent-toolkit 1.11.0) filters disabled tools out
 * of getTools() but handleToolCall() dispatches any tool name the model emits, and
 * interpolates dispute_id into the URL unescaped. The shield enforces, before the
 * toolkit runs:
 *   - the configured tool allow-list            -> VETO_TOOLKIT_ACL_BYPASS
 *   - the PayPal id alphabet ^[A-Za-z0-9-]+$     -> VETO_PATH_TRAVERSAL_BLOCKED
 * Mutating tools are additionally routed through the VerdictPay Sentinel
 * (POST /api/v1/veto-lab/sentinel) when a sentinelUrl is configured.
 */

export type ToolCall = {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
};

export type ShieldVerdict = {
  exit_code: 0 | 2;
  verdict: "ALLOW" | "VETO";
  veto_codes: string[];
  reasons: string[];
};

type Inner = { handleToolCall(call: ToolCall): Promise<unknown> };

const ID_PATTERN = /^[A-Za-z0-9-]{3,64}$/;
const ID_FIELDS = ["dispute_id", "order_id", "invoice_id", "subscription_id", "transaction_id"];

export class CliffGuardToolkitShield {
  readonly allowed: ReadonlySet<string>;
  private readonly inner: Inner;

  constructor(inner: Inner, allowedTools: Iterable<string>) {
    this.inner = inner;
    this.allowed = new Set(allowedTools);
  }

  inspect(call: ToolCall): ShieldVerdict {
    const codes: string[] = [];
    const reasons: string[] = [];
    if (!this.allowed.has(call.function.name)) {
      codes.push("VETO_TOOLKIT_ACL_BYPASS");
      reasons.push(`tool ${call.function.name} is not in the configured allow-list`);
    }
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || "{}");
      if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
    } catch {
      codes.push("VETO_SCHEMA_INVALID");
      reasons.push("tool arguments are not valid JSON");
    }
    for (const field of ID_FIELDS) {
      const value = args[field];
      if (value !== undefined && (typeof value !== "string" || !ID_PATTERN.test(value))) {
        codes.push("VETO_PATH_TRAVERSAL_BLOCKED");
        reasons.push(`${field}=${JSON.stringify(value)} is not a PayPal id (no '/', '..', '?', '&')`);
      }
    }
    const unique = [...new Set(codes)];
    return {
      exit_code: unique.length ? 2 : 0,
      verdict: unique.length ? "VETO" : "ALLOW",
      veto_codes: unique,
      reasons,
    };
  }

  async handleToolCall(call: ToolCall): Promise<{ verdict: ShieldVerdict; result?: unknown }> {
    const verdict = this.inspect(call);
    if (verdict.exit_code !== 0) return { verdict };
    return { verdict, result: await this.inner.handleToolCall(call) };
  }
}
