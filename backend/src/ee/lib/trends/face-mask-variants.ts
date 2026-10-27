/**
 * A trend's per-person face mask variants (decided 2026-10-27; pure, no I/O).
 *
 * A trend's stored face mask covers every face in its source clip. An admin
 * may mark which faces belong to which OPTIONAL PERSON slot (slot marks,
 * `{ slot }` labels on `faceMasking.marks`). When a run leaves such a person
 * empty, the engine keeps that person as in the clip — so the clip it is
 * sent must not hide that person's face. One variant per combination of
 * marked people left empty (every non-empty subset: 2^k − 1 of them, k at
 * most `CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarkedPeople`) is made ahead of
 * time from the approved mask's raw mask, by the core `mask-erase` job:
 *   - always erased (`eraseAlways`): the `"erased"` ("Everyone") marks'
 *     boxes — they apply in every variant exactly as in the base, whatever
 *     keep says;
 *   - erased (`erase`): the slot marks of the people left empty;
 *   - kept (`keep`): the slot marks of every other marked person, which
 *     override the empty people's boxes only: a blob a filled person shares
 *     with an empty one stays covered;
 *   - then filled as the base is (the engine's face-mask make, from that
 *     erased mask).
 * A run picks the variant whose `emptySlots` are exactly the marked people
 * it leaves empty (compose.ts). Every variant is tied to a key
 * (`faceMaskVariantKey`): the base's settings key and raw mask, and every
 * slot mark, so any edit of them makes it out of date.
 *
 * Only a trend with NO examples has truly empty optional slots: with
 * examples, an empty slot takes the chosen example's pictures (compose.ts),
 * so that person is replaced and the mask stays whole. Slot marks are then
 * allowed but do nothing at run time (`faceMaskVariantsApply`).
 */
import { createHash } from "node:crypto"
import { CAST_SWAP_FACE_MASK_MARK_LIMITS } from "@nodaro/render-rules"
import { CAST_SWAP_FACE_MASKING_DEFAULTS } from "@nodaro/shared/models"
import { boxOf, erasedBoxesOf, faceMaskingOn, faceMaskingSourceOf, slotMarksOf, type MaskEraseBox } from "../../../lib/cast-swap-face-masking.js"
import { faceMaskSettingsKey, stableJson } from "./face-mask.js"
import type { TrendFaceMaskVariant, TrendFaceMaskVariantJob, TrendVersionData } from "./types.js"

/** The most optional people with slot marks a published trend may have. */
export const MAX_MARKED_PEOPLE = CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarkedPeople

type MarksData = Pick<TrendVersionData, "slots" | "faceMasking">

/** A set of slot keys as stored and compared: each once, sorted. A new array. */
export function canonicalSlots(keys: readonly string[]): string[] {
  return [...new Set(keys)].sort()
}

/** Whether two canonical sets name the same people. */
export function sameSlots(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i])
}

/**
 * The optional person slots that carry at least one slot mark, sorted by key.
 * Only marks naming an optional person of this version count (the trend
 * schema refuses any other); none when the trend does not mask, or prepares
 * its clip in a depth mode (per-person variants are a face mask's alone).
 */
export function markedPeople(data: MarksData): string[] {
  if (!faceMaskingOn(data.faceMasking) || faceMaskingSourceOf(data.faceMasking) !== "faces") return []
  const optional = new Set(data.slots.filter((s) => s.kind === "person" && !s.required).map((s) => s.key))
  return canonicalSlots(slotMarksOf(data.faceMasking).map((m) => m.slot).filter((k) => optional.has(k)))
}

/** Whether more optional people carry slot marks than a published trend may (`MAX_MARKED_PEOPLE`). */
export function faceMaskVariantsOverCap(data: MarksData): boolean {
  return markedPeople(data).length > MAX_MARKED_PEOPLE
}

/**
 * Whether this trend's runs can leave a marked person empty, so it needs its
 * variants: it masks, has marked people, and has NO examples (with examples,
 * an empty slot takes an example's pictures).
 */
export function faceMaskVariantsApply(data: MarksData & Pick<TrendVersionData, "examples">): boolean {
  return data.examples.length === 0 && markedPeople(data).length > 0
}

/**
 * Every set of marked people a run can leave empty (each non-empty subset,
 * canonical, in a fixed order: by size, then by key), or none when the
 * variants do not apply or the trend has more marked people than the cap.
 */
export function faceMaskVariantSets(data: MarksData & Pick<TrendVersionData, "examples">): string[][] {
  if (!faceMaskVariantsApply(data) || faceMaskVariantsOverCap(data)) return []
  const people = markedPeople(data)
  const sets: string[][] = []
  for (let bits = 1; bits < 1 << people.length; bits++) sets.push(people.filter((_, i) => bits & (1 << i)))
  return sets.sort((a, b) => a.length - b.length || a.join(",").localeCompare(b.join(",")))
}

/**
 * The boxes the variant for `emptySlots` sends the core `mask-erase` job:
 * `eraseAlways` = the `"erased"` marks' boxes (dropped whatever keep says);
 * `erase` = the slot marks of the people in `emptySlots`; `keep` = the slot
 * marks of every other marked person (they override `erase` only).
 */
export function faceMaskVariantBoxes(
  data: MarksData,
  emptySlots: readonly string[],
): { eraseAlways: MaskEraseBox[]; erase: MaskEraseBox[]; keep: MaskEraseBox[] } {
  const empty = new Set(emptySlots)
  const people = new Set(markedPeople(data))
  const marks = slotMarksOf(data.faceMasking).filter((m) => people.has(m.slot))
  return {
    eraseAlways: erasedBoxesOf(data.faceMasking),
    erase: marks.filter((m) => empty.has(m.slot)).map((m) => boxOf(m.mark)),
    keep: marks.filter((m) => !empty.has(m.slot)).map((m) => boxOf(m.mark)),
  }
}

/**
 * The key of the variant for `emptySlots`: a hash of the base's settings key
 * (`faceMaskSettingsKey`: the source, the settings and the `"erased"` marks),
 * the approved mask's raw mask (and depth view, fill "depth"), the set, and
 * the erase and keep boxes (in a fixed order). Null when the draft has no
 * approved mask with a raw mask, or does not mask: no variant can be made.
 */
export function faceMaskVariantKey(
  data: MarksData & Pick<TrendVersionData, "source" | "faceMask">,
  emptySlots: readonly string[],
): string | null {
  const mask = data.faceMask
  const settingsKey = faceMaskSettingsKey(data)
  if (!mask?.rawMaskUrl || settingsKey === null) return null
  const fill = data.faceMasking?.fill ?? CAST_SWAP_FACE_MASKING_DEFAULTS.fill
  const { eraseAlways, erase, keep } = faceMaskVariantBoxes(data, emptySlots)
  const sorted = (boxes: readonly MaskEraseBox[]) => boxes.map(stableJson).sort()
  const text = stableJson({
    eraseAlways: sorted(eraseAlways),
    settingsKey,
    rawMaskUrl: mask.rawMaskUrl,
    ...(fill === "depth" ? { depthUrl: mask.depthUrl ?? null } : {}),
    emptySlots: canonicalSlots(emptySlots),
    erase: sorted(erase),
    keep: sorted(keep),
  })
  return `pv1:${createHash("sha256").update(text).digest("hex")}`
}

/** Why the draft's approved mask cannot make variants, or null when it can. */
export type FaceMaskVariantBaseProblem = "no_base" | "base_out_of_date" | "no_raw_mask"

/**
 * Whether variants can be made from the draft's approved mask: it must be
 * there, made from the draft's current settings (its settings key), with its
 * raw mask kept (and its depth view, fill "depth"). The recipes are the
 * base's own check (`faceMaskState`).
 */
export function faceMaskVariantBaseProblem(data: MarksData & Pick<TrendVersionData, "source" | "faceMask">): FaceMaskVariantBaseProblem | null {
  const mask = data.faceMask
  if (!mask) return "no_base"
  if (mask.settingsKey !== faceMaskSettingsKey(data)) return "base_out_of_date"
  const fill = data.faceMasking?.fill ?? CAST_SWAP_FACE_MASKING_DEFAULTS.fill
  if (!mask.rawMaskUrl || (fill === "depth" && !mask.depthUrl)) return "no_raw_mask"
  return null
}

/**
 * One variant's state: `approved` (stored, up to date), `making` (a job for
 * the current key in flight), `failed` (that job failed), `out_of_date`
 * (stored for other marks or another base) or `missing`.
 */
export type FaceMaskVariantStatus = "approved" | "making" | "failed" | "missing" | "out_of_date"

export interface FaceMaskVariantEntry {
  emptySlots: string[]
  status: FaceMaskVariantStatus
  variant?: TrendFaceMaskVariant
  job?: TrendFaceMaskVariantJob
}

export interface FaceMaskVariantsState {
  /** Runs can leave a marked person empty (no examples, marked people). */
  applies: boolean
  /** The optional people with slot marks (sorted keys). */
  people: string[]
  /** More marked people than `MAX_MARKED_PEOPLE`: publishing is refused. */
  overCap: boolean
  /** Why no variant can be made from the approved mask, or null. */
  baseProblem: FaceMaskVariantBaseProblem | null
  /** One entry per set a run can leave empty (`faceMaskVariantSets`). */
  variants: FaceMaskVariantEntry[]
}

type VariantData = MarksData & Pick<TrendVersionData, "source" | "faceMask" | "examples">

/** The draft's variants, as the editor shows them and publishing checks them. */
export function faceMaskVariantsState(data: VariantData): FaceMaskVariantsState {
  const people = markedPeople(data)
  const applies = faceMaskVariantsApply(data)
  const variants = faceMaskVariantSets(data).map((set): FaceMaskVariantEntry => {
    const key = faceMaskVariantKey(data, set)
    const variant = data.faceMask?.variants?.find((v) => sameSlots(v.emptySlots, set))
    const job = data.faceMask?.variantJobs?.find((j) => sameSlots(j.emptySlots, set) && key !== null && j.key === key)
    const status: FaceMaskVariantStatus =
      job && !job.error ? "making"
      : variant && key !== null && variant.key === key ? "approved"
      : job?.error ? "failed"
      : variant ? "out_of_date"
      : "missing"
    return { emptySlots: set, status, ...(variant ? { variant } : {}), ...(job ? { job } : {}) }
  })
  return { applies, people, overCap: people.length > MAX_MARKED_PEOPLE, baseProblem: applies ? faceMaskVariantBaseProblem(data) : null, variants }
}

/**
 * What a run that leaves the marked people `emptySlots` empty is sent: the
 * up-to-date variant for exactly that set (`{ url, frames }`), `"unmasked"`
 * when that variant left nothing to cover, or null when there is none (the
 * run is refused, as with no stored mask).
 */
export function faceMaskVariantFor(data: VariantData, emptySlots: readonly string[]): { url: string; frames: number } | "unmasked" | null {
  const set = canonicalSlots(emptySlots)
  const key = faceMaskVariantKey(data, set)
  const variant = data.faceMask?.variants?.find((v) => sameSlots(v.emptySlots, set))
  if (!variant || key === null || variant.key !== key) return null
  return variant.url ? { url: variant.url, frames: variant.frames } : "unmasked"
}

/**
 * `data` with its face mask's person variants held to the sets a run can
 * leave empty now (`faceMaskVariantSets`): a variant for a set that no longer
 * exists is dropped (an out-of-date one for a current set stays, shown as
 * such); a job record (in the making or failed) is kept only while it is for
 * a current set and that set's current key.
 *
 * While the person masks do not apply at all — masking off, examples, or more
 * marked people than the cap — the trend may only be passing through (an
 * example added and removed, a fourth person marked by mistake), so its
 * variants are left as they are and match again once it is back; only the
 * job records whose key no longer matches are dropped. `abandoned`: the jobs
 * in the making dropped, whose own jobs the caller closes. A new object;
 * `data` itself as it is when nothing is dropped.
 */
export function withCurrentVariants<T extends VariantData>(data: T): { data: T; abandoned: TrendFaceMaskVariantJob[] } {
  const mask = data.faceMask
  if (!mask || (!mask.variants && !mask.variantJobs)) return { data, abandoned: [] }
  const paused = !faceMaskVariantsApply(data) || faceMaskVariantsOverCap(data)
  const sets = faceMaskVariantSets(data)
  const current = (set: readonly string[]) => paused || sets.some((s) => sameSlots(s, set))
  const variants = (mask.variants ?? []).filter((v) => current(v.emptySlots))
  const keptJobs = (mask.variantJobs ?? []).filter((j) => current(j.emptySlots) && faceMaskVariantKey(data, j.emptySlots) === j.key)
  const abandoned = (mask.variantJobs ?? []).filter((j) => !keptJobs.includes(j) && j.error === undefined)
  if (variants.length === (mask.variants ?? []).length && keptJobs.length === (mask.variantJobs ?? []).length) return { data, abandoned: [] }
  const { variants: _v, variantJobs: _j, ...rest } = mask
  const faceMask = { ...rest, ...(variants.length > 0 ? { variants } : {}), ...(keptJobs.length > 0 ? { variantJobs: keptJobs } : {}) }
  return { data: { ...data, faceMask }, abandoned }
}

/**
 * The variants and variant jobs of `data`'s face mask still worth keeping on
 * `next` (a new approved base, or after a variant edit): those whose set a
 * run can still leave empty and whose key is still the current one. New arrays.
 */
export function keptVariantsFor(
  next: VariantData,
  from: Pick<TrendVersionData, "faceMask">,
): { variants?: TrendFaceMaskVariant[]; variantJobs?: TrendFaceMaskVariantJob[] } {
  const sets = faceMaskVariantSets(next)
  const current = (set: readonly string[], key: string) =>
    sets.some((s) => sameSlots(s, set)) && faceMaskVariantKey(next, set) === key
  const variants = (from.faceMask?.variants ?? []).filter((v) => current(v.emptySlots, v.key))
  const variantJobs = (from.faceMask?.variantJobs ?? []).filter((j) => current(j.emptySlots, j.key))
  return {
    ...(variants.length > 0 ? { variants: structuredClone(variants) } : {}),
    ...(variantJobs.length > 0 ? { variantJobs: structuredClone(variantJobs) } : {}),
  }
}
