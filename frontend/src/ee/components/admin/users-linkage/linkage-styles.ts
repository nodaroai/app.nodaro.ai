import type { LinkageAxis, SizeTier } from "./types"

/**
 * The marking's colours are CSS custom properties (users-linkage.css), set
 * once for light and once under `.dark`, so a row's inline style can name a
 * tier's colour without knowing which theme is on.
 */

export type TierPart = "color" | "tint" | "linked" | "active"

export const tierVar = (tier: SizeTier, part: TierPart): string => `var(--ulk-${tier}-${part})`

export const axisVar = (axis: LinkageAxis): string => `var(--ulk-axis-${axis})`

/** Text drawn over a tier or axis colour. */
export const ON_TIER = "var(--ulk-on-tier)"

export type DecisionKind = "withheld" | "granted" | "revoked"

export const decisionVars = (kind: DecisionKind): { background: string; color: string } => ({
  background: `var(--ulk-${kind}-bg)`,
  color: `var(--ulk-${kind}-fg)`,
})

export const REASON_CHIP = { background: "var(--ulk-reason-bg)", color: "var(--ulk-reason-fg)" } as const
