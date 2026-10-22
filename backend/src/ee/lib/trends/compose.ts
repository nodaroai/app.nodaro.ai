/**
 * A trend run → the Cast Swap engine body (pure; no I/O).
 *
 * The public and admin run routes call this with the trend version a run uses
 * (published for users, the draft for admin test runs) and the user's
 * validated request (`trendRunRequestSchema`). It returns:
 *
 * - `body`: what the engine reads — the hidden source clip, roles named by
 *   their hidden `roleName`, the fixed references, the trend prompt, and the
 *   trend's pre prompt and face masking (top-level fields; the engine refuses
 *   either inside `display`);
 * - `display`: the public record of the run (English labels, the user's own
 *   pictures, the example's pictures for empty optional slots, the chips and
 *   the user's raw details), also carried in `body.trendRun.display`;
 * - `needs`: what the engine must support for this run.
 *
 * HIDDEN data (source, roleName, references, trendPrompt, prePrompt,
 * faceMasking) goes only into the engine's own fields, never into `display`.
 *
 * Masking off (absent, or `mode: "off"`) sends no `faceMasking` key at all, so
 * the body is exactly what it was before trends had masking.
 */
import { CAST_SWAP_POST_PROMPT_MAX } from "@nodaro/shared/models"
import { faceMaskingOn, type FaceMasking } from "../../../lib/cast-swap-face-masking.js"
import { CHIPS_BY_KIND, misplacedChip } from "./schemas.js"
import { pickText } from "./localize.js"
import type {
  Choice,
  TrendReference,
  TrendResolution,
  TrendRunRequest,
  TrendRunSlot,
  TrendSlot,
  TrendSlotKind,
  TrendVersionData,
} from "./types.js"

export type TrendRunErrorCode =
  | "missing_slot"
  | "unknown_slot"
  | "invalid_choice"
  | "example_out_of_range"
  | "preview_unavailable"
  | "invalid_slot_mention"
  | "source_missing"
  | "prompt_too_long"

export class TrendRunError extends Error {
  constructor(
    readonly code: TrendRunErrorCode,
    message: string,
    readonly slot?: string,
  ) {
    super(message)
    this.name = "TrendRunError"
  }
}

type Chips = { body?: Choice; outfit?: Choice; hair?: Choice; coat?: Choice; shape?: Choice; finish?: Choice }

export interface TrendRunDisplaySlot extends Chips {
  key: string
  /** English. */
  label: string
  kind: TrendSlotKind
  images: string[]
  /** True when the slot was left empty and the example's pictures filled it. */
  fromExample: boolean
}

export interface TrendRunDisplay {
  trend: { id: string; slug: string; version: number; /** English. */ name: string }
  /** 1-based example used for empty optional slots. */
  example: number
  slots: TrendRunDisplaySlot[]
  /** The user's own details, as sent (`{slot:<key>}` mentions unmapped). */
  details?: string
}

export interface TrendRunBody {
  videoUrl: string
  roles: unknown[]
  references: TrendReference[]
  prePrompt?: string
  postPrompt?: string
  faceMasking?: FaceMasking
  preview: boolean
  previewStart: number
  resolution: TrendResolution
  draft: boolean
  trendRun: { display: TrendRunDisplay }
}

export interface ComposedTrendRun {
  body: TrendRunBody
  display: TrendRunDisplay
  needs: { roleKinds: Set<TrendSlotKind>; fixedReferences: boolean; faceMasking: boolean; trendPrePrompt: boolean }
}

/**
 * The Cast Swap engine's `postPrompt` cap (the cast-swap plugin's input
 * schema: `postPrompt: z.string().max(4000)`; the number is
 * `@nodaro/shared`'s). The trend prompt, a blank line and the user's details
 * share it. New versions are held to a 2998-character trend prompt so the
 * details (≤ 1000) always fit: prompt-budget.ts has the numbers, publishing
 * refuses a longer one (publish-check.ts) and the admin screen holds Save.
 * Versions published before that may still carry up to 3000, so a run can
 * still pass the cap: composeTrendRun refuses it (`prompt_too_long`) before
 * the engine would.
 */
export { CAST_SWAP_POST_PROMPT_MAX }

const SLOT_MENTION_RE = /\{slot:([^}]*)\}/g

function entryOf(req: TrendRunRequest, key: string): TrendRunSlot | undefined {
  return Object.hasOwn(req.slots, key) ? req.slots[key] : undefined
}

/** The slot kind's chips: the request's, else the slot's default, else "new". */
function chipsOf(slot: TrendSlot, entry: TrendRunSlot | undefined): Chips {
  const defaults = (slot.defaults ?? {}) as Chips
  const out: Chips = {}
  for (const chip of CHIPS_BY_KIND[slot.kind]) {
    out[chip] = entry?.[chip] ?? defaults[chip] ?? "new"
  }
  return out
}

export function composeTrendRun(
  trend: { id: string; slug: string; version: number; data: TrendVersionData },
  req: TrendRunRequest,
): ComposedTrendRun {
  const { data } = trend

  if (!data.source) throw new TrendRunError("source_missing", "This trend has no source clip yet.")

  const slotKeys = new Set(data.slots.map((s) => s.key))
  for (const key of Object.keys(req.slots)) {
    if (!slotKeys.has(key)) throw new TrendRunError("unknown_slot", `This trend has no slot "${key}".`, key)
  }

  const misplaced = misplacedChip(req, data)
  if (misplaced) {
    throw new TrendRunError("invalid_choice", `Slot "${misplaced.slot}" does not take "${misplaced.chip}".`, misplaced.slot)
  }

  const example = req.example ?? 1
  const exampleInRange = Number.isInteger(example) && example >= 1 && example <= data.examples.length
  // An explicit example must exist. The default (Example 1) is only needed
  // when an optional slot is left empty, so a draft with no examples yet can
  // still be test-run with every slot filled.
  if (req.example !== undefined && !exampleInRange) {
    throw new TrendRunError("example_out_of_range", `This trend has no example ${req.example}.`)
  }

  const slots: TrendRunDisplaySlot[] = []
  const roles: unknown[] = []
  for (const slot of data.slots) {
    const entry = entryOf(req, slot.key)
    const own = entry?.images ?? []
    let images: string[]
    let fromExample = false
    if (own.length > 0) {
      images = [...own]
    } else if (slot.required) {
      throw new TrendRunError("missing_slot", `"${pickText(slot.label, "en")}" needs a picture.`, slot.key)
    } else {
      if (!exampleInRange) throw new TrendRunError("example_out_of_range", `This trend has no example ${example}.`)
      const fill = data.examples[example - 1]!.slots
      const picked = Object.hasOwn(fill, slot.key) ? fill[slot.key] : undefined
      if (!picked || picked.length === 0) {
        throw new TrendRunError("missing_slot", `"${pickText(slot.label, "en")}" needs a picture.`, slot.key)
      }
      images = [...picked]
      fromExample = true
    }

    const chips = chipsOf(slot, entry)
    roles.push({ kind: slot.kind, name: slot.roleName, images, ...chips })
    slots.push({ key: slot.key, label: pickText(slot.label, "en")!, kind: slot.kind, images: [...images], fromExample, ...chips })
  }

  if (req.preview && data.previewStart === null) {
    throw new TrendRunError("preview_unavailable", "This trend has no preview.")
  }

  const details = req.details ?? ""
  const mapped = details.replace(SLOT_MENTION_RE, (_m, key: string) => {
    const i = data.slots.findIndex((s) => s.key === key)
    if (i < 0) throw new TrendRunError("invalid_slot_mention", `Details mention an unknown slot "${key}".`, key)
    return `{role:${i + 1}}`
  })
  const postPrompt = [data.trendPrompt, mapped].filter(Boolean).join("\n\n")
  if (postPrompt.length > CAST_SWAP_POST_PROMPT_MAX) {
    throw new TrendRunError(
      "prompt_too_long",
      `The trend prompt and details come to ${postPrompt.length} characters; the most is ${CAST_SWAP_POST_PROMPT_MAX}.`,
    )
  }

  const masking = faceMaskingOn(data.faceMasking) ? data.faceMasking : undefined
  const resolution: TrendResolution = req.resolution ?? "480p"
  const draft = resolution === "480p" && (req.draft ?? true)

  const display: TrendRunDisplay = {
    trend: { id: trend.id, slug: trend.slug, version: trend.version, name: pickText(data.name, "en")! },
    example,
    slots,
    ...(details ? { details } : {}),
  }

  const body: TrendRunBody = {
    videoUrl: data.source.videoUrl,
    roles,
    references: data.references.map((r) => ({ images: [...r.images], line: r.line })),
    ...(data.prePrompt ? { prePrompt: data.prePrompt } : {}),
    ...(postPrompt ? { postPrompt } : {}),
    ...(masking ? { faceMasking: structuredClone(masking) } : {}),
    preview: req.preview ?? false,
    previewStart: data.previewStart ?? 0,
    resolution,
    draft,
    trendRun: { display },
  }

  return {
    body,
    display,
    needs: {
      roleKinds: new Set(data.slots.map((s) => s.kind)),
      fixedReferences: data.references.length > 0,
      faceMasking: masking !== undefined,
      trendPrePrompt: !!data.prePrompt,
    },
  }
}
