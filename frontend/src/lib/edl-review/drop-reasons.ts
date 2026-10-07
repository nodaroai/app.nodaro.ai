/**
 * How the review inspector shows each drop reason: its label (a dictionary
 * key, in every locale) and its own strike colour. The reasons are the ones
 * Edit Plan writes (silence, filler, false start, tangent, no picture) and the
 * reviewer's own cuts (manual).
 *
 * `EdlDropped.reason` is an open string, so a newer planner can send a reason
 * this table does not know. It falls back: its label is the reason as written
 * (`labelOf`), its strike a neutral dashed one no known reason uses. A blank
 * reason reads "Other".
 *
 * The classes are literal strings so Tailwind finds them; never build one from
 * a colour name.
 */
import { labelOf, tx, type MessageKey, type TFunction } from "@/lib/i18n"

/** In the order the inspector lists them: the planner's reasons, then the reviewer's own cuts. */
export const DROP_REASONS = ["silence", "filler", "false-start", "tangent", "no-picture", "manual"] as const
export type DropReason = (typeof DROP_REASONS)[number]

export interface DropReasonStyle {
  /** On a struck word: the strike-through and its colour. */
  readonly strike: string
  /** A solid dot of the colour: the reasons list, a legend. */
  readonly swatch: string
  /** A tinted chip naming the span, in light and dark themes. */
  readonly chip: string
  /** The same colour as a CSS value, for what a class cannot paint (the minimap's canvas). */
  readonly color: string
}

const LABELS: Readonly<Record<DropReason, MessageKey>> = {
  silence: "edlReview.reason.silence",
  filler: "edlReview.reason.filler",
  "false-start": "edlReview.reason.falseStart",
  tangent: "edlReview.reason.tangent",
  manual: "edlReview.reason.manual",
  "no-picture": "edlReview.reason.noPicture",
}

const STYLES: Readonly<Record<DropReason, DropReasonStyle>> = {
  silence: {
    strike: "line-through decoration-2 decoration-sky-500",
    swatch: "bg-sky-500",
    chip: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    color: "#0ea5e9",
  },
  filler: {
    strike: "line-through decoration-2 decoration-amber-500",
    swatch: "bg-amber-500",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    color: "#f59e0b",
  },
  "false-start": {
    strike: "line-through decoration-2 decoration-rose-500",
    swatch: "bg-rose-500",
    chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    color: "#f43f5e",
  },
  tangent: {
    strike: "line-through decoration-2 decoration-violet-500",
    swatch: "bg-violet-500",
    chip: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    color: "#8b5cf6",
  },
  manual: {
    strike: "line-through decoration-2 decoration-emerald-500",
    swatch: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    color: "#10b981",
  },
  "no-picture": {
    strike: "line-through decoration-2 decoration-zinc-500",
    swatch: "bg-zinc-500",
    chip: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
    color: "#71717a",
  },
}

const FALLBACK_STYLE: DropReasonStyle = {
  strike: "line-through decoration-2 decoration-dashed decoration-stone-400",
  swatch: "bg-stone-400",
  chip: "bg-stone-400/15 text-stone-700 dark:text-stone-300",
  color: "#a8a29e",
}

export function isKnownDropReason(reason: string): reason is DropReason {
  return Object.hasOwn(LABELS, reason)
}

export function dropReasonStyle(reason: string): DropReasonStyle {
  return isKnownDropReason(reason) ? STYLES[reason] : FALLBACK_STYLE
}

/** The reason's label in the current language — pass a component's `t`. */
export function dropReasonLabel(reason: string, t: TFunction = tx): string {
  return reason.trim() ? labelOf(LABELS, reason, t) : t("edlReview.reason.other")
}
