"use client";

import { ArrowRight, Check, Info, Lock, X } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/format";
import { RECOMMENDATION_META } from "@/lib/vocab";
import type { DecisionComparison, DecisionOption } from "@/lib/types";

/* --------------------------------------------------------------------------
   Policy choice vs lowest modelled loss.

   These are two different questions and the case room must not conflate them:
   the rules pick a response for reasons the EV model does not price (customer
   relationship, arbitration exposure), while the EV model names the cheapest
   modelled outcome. When they disagree, both are shown side by side with the
   backend's own divergence explanation — never softened into "the best option".
-------------------------------------------------------------------------- */

function OptionRow({ option }: { option: DecisionOption }): React.JSX.Element {
  const meta = RECOMMENDATION_META[option.action];
  return (
    <li
      className={cn(
        "flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5",
        option.is_policy_choice || option.is_best_financial ? "bg-raised" : "bg-surface",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <Badge tone={meta.tone} size="sm">
          {option.label}
        </Badge>
        {option.is_policy_choice ? (
          <Badge tone="neutral" size="sm">
            Policy pick
          </Badge>
        ) : null}
        {option.is_best_financial ? (
          <Badge tone="positive" size="sm">
            Lowest loss
          </Badge>
        ) : null}
      </span>

      <span className="num shrink-0 text-sm font-medium text-ink">
        {formatUsd(option.value_usd)}
      </span>

      {/* Availability is a PayPal fact, not a preference: it says whether the
          action can actually be filed on this case right now. */}
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 text-2xs",
          option.paypal_action_available ? "text-positive" : "text-muted",
        )}
        title={option.paypal_action_reason ?? undefined}
      >
        {option.paypal_action_available ? (
          <Check size={11} aria-hidden />
        ) : (
          <Lock size={11} aria-hidden />
        )}
        {option.paypal_action_available ? "Available in PayPal" : "Not available"}
      </span>

      <p className="w-full min-w-0 text-xs text-muted">{option.detail}</p>
      {!option.paypal_action_available && option.paypal_action_reason ? (
        <p className="w-full min-w-0 text-xs text-warning">{option.paypal_action_reason}</p>
      ) : null}
    </li>
  );
}

/** The comparison for one case, or an explicit "not reported" state. */
export function DecisionComparisonPanel({
  comparison,
}: {
  comparison: DecisionComparison | null;
}): React.JSX.Element {
  if (comparison === null) {
    return (
      <Panel>
        <PanelHeader
          title="Policy vs lowest loss"
          description="Which action the policy picks, which one has the cheapest modelled loss, and why they can differ."
        />
        <PanelBody>
          <p className="flex items-start gap-2 text-sm text-muted">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              This case carries no decision comparison yet. Recomputing the EV attaches one; the
              policy recommendation and the financial ranking are then shown side by side instead of
              being collapsed into a single claim.
            </span>
          </p>
        </PanelBody>
      </Panel>
    );
  }

  const policyMeta = RECOMMENDATION_META[comparison.policy_action];
  const bestMeta = RECOMMENDATION_META[comparison.best_financial_action];
  const policyOption = comparison.options.find((option) => option.is_policy_choice) ?? null;
  const bestOption = comparison.options.find((option) => option.is_best_financial) ?? null;
  const gap =
    policyOption && bestOption ? Math.abs(bestOption.value_usd - policyOption.value_usd) : null;

  return (
    <Panel>
      <PanelHeader
        title="Policy vs lowest loss"
        description="Two different questions: which response the rules select, and which one has the cheapest modelled loss. They are allowed to disagree."
        actions={
          comparison.agree ? (
            <Badge tone="positive" dot>
              Aligned
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Diverges
            </Badge>
          )
        }
      />

      <PanelBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-md border border-control bg-ground px-3.5 py-3">
            <p className="label">Policy picks</p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Badge tone={policyMeta.tone} size="sm">
                {comparison.policy_label}
              </Badge>
              {policyOption ? (
                <span className="num text-sm text-ink">{formatUsd(policyOption.value_usd)}</span>
              ) : null}
            </div>
            <p className="mt-1.5 break-words text-xs text-muted [overflow-wrap:anywhere]">
              {comparison.policy_reason}
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-control bg-ground px-3.5 py-3">
            <p className="label">Lowest modelled loss</p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Badge tone={bestMeta.tone} size="sm">
                {comparison.best_financial_label}
              </Badge>
              {bestOption ? (
                <span className="num text-sm text-ink">{formatUsd(bestOption.value_usd)}</span>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {comparison.agree
                ? "The policy pick is also the cheapest modelled outcome."
                : gap !== null
                  ? `Cheaper by ${formatUsd(gap)} on the modelled numbers alone.`
                  : "The financial ranking differs from the policy pick."}
            </p>
          </div>
        </div>

        {/* The backend's own explanation, rendered verbatim: it is the only place
            that knows the policy's actual reason for preferring a costlier action. */}
        {comparison.agree ? null : comparison.divergence_explanation ? (
          <p className="flex min-w-0 items-start gap-2 rounded-md border border-control bg-ground px-3.5 py-3 text-sm text-ink">
            <ArrowRight size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{comparison.divergence_explanation}</span>
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted">
            <X size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              The policy pick is not the cheapest modelled outcome, and no explanation was reported
              with this case.
            </span>
          </p>
        )}

        {comparison.options.length > 0 ? (
          <ul className="overflow-hidden rounded-md border border-control">
            {comparison.options.map((option) => (
              <OptionRow key={option.action} option={option} />
            ))}
          </ul>
        ) : null}
      </PanelBody>

      <PanelFooter>
        <p className="text-xs text-muted">
          Each figure is the modelled expected loss for that action. Availability reflects what
          PayPal permits on this case at its current stage, not a preference.
        </p>
      </PanelFooter>
    </Panel>
  );
}
