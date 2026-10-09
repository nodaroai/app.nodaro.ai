import { REASON_LABELS } from "@/ee/components/admin/free-grants/types"
import { AXES, AXIS_LABELS, type LinkageCluster, type LinkageUser } from "./types"
import { gateLine, sharedText } from "./linkage-model"
import { axisVar, REASON_CHIP } from "./linkage-styles"
import { AxisDot } from "./linkage-marker"

/**
 * The top of an opened row, for an account that has a claim-time signal row:
 * the three keys with how many accounts share each, and the gate's decision
 * with the rules that fired. Tokens, never the stored hashes (see the backend).
 */
export function SignalsDetail({
  user,
  cluster,
  partial = false,
}: {
  readonly user: LinkageUser
  readonly cluster: LinkageCluster | null
  /** The walk was cut short: a count of one is "not checked", not "unique". */
  readonly partial?: boolean
}) {
  return (
    <div
      data-testid="signals-detail"
      className="mb-4 grid gap-3 rounded-lg p-3"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", background: "var(--ulk-detail-bg)" }}
    >
      {AXES.map((axis) => {
        const signal = user.signals?.[axis] ?? null
        return (
          <div
            key={axis}
            className="rounded-lg border bg-card px-3 py-2.5"
            style={{ borderInlineStart: `3px solid ${axisVar(axis)}` }}
          >
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <AxisDot axis={axis} />
              {AXIS_LABELS[axis]}
            </div>
            <div className="my-1 font-mono text-[15px]">{signal ? signal.token : "—"}</div>
            <div className="text-[12.5px] text-muted-foreground">
              {signal
                ? sharedText(signal.count, partial)
                : axis === "ip"
                  ? "no real client address recorded (signed up before addresses were read, or unknown)"
                  : "not recorded"}
            </div>
          </div>
        )
      })}
      <div className="rounded-lg border bg-card px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Gate</div>
        {user.reasons.length > 0 && (
          <div className="my-1.5 flex flex-wrap gap-1">
            {user.reasons.map((reason) => (
              <span
                key={reason}
                title={REASON_LABELS[reason] ?? reason}
                className="rounded-[5px] px-1.5 py-0.5 font-mono text-[11.5px]"
                style={REASON_CHIP}
              >
                {reason}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1 text-[12.5px] text-muted-foreground">{gateLine(user, cluster)}</div>
      </div>
    </div>
  )
}
