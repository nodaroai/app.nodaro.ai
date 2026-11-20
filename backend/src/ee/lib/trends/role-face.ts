/**
 * A trend's Face chip (decided 2026-11-20; pure, no I/O): whether a trend
 * stores one, whether its runs can keep a person's own face, and what a run
 * on a stored face mask sends so the engine can remake the mask for it.
 *
 * A person slot's `face` is "new" (the face from the pictures) or "original"
 * (the person keeps their own face from the clip, and is never face-masked).
 * It is offered only where the slot lists it in `chips` (`OPT_IN_CHIPS`), and
 * a run sends it only when chosen (compose.ts `chipsOf`).
 *
 * A stored face mask covers every person's face. A run that keeps one
 * person's face ("original") while another, pictured person takes a new one
 * (`mixesFaces`) needs that mask made again without the kept faces: the
 * engine (`castSwap.roleFaceStoredMask`) does it from what the trend kept of
 * its make (`roleFaceRemakeFor`):
 *   - `raw`: the mask before any mark was applied (`TrendFaceMask.rawMaskUrl`)
 *     and, on a depth fill, its depth view (`depthUrl`), while they belong to
 *     the draft's base settings (`baseKey` = `faceMaskBaseKey`);
 *   - `erase`: the trend's "erased" boxes (`faceMasking.marks`), labels dropped;
 *   - `roleBoxes`: each person role's boxes, from the role outlines its make
 *     drew (`makeOutlinesOf`: role outlines on, the slot's own marks), role N
 *     the run's Nth role, as `storedFaceMask.outlines` numbers them.
 * What the trend lacks is left out; the engine then refuses the run
 * (`role_face_with_stored_mask`). The publish check names a trend whose mixed
 * runs would be refused (`faceChipStoredMaskBlockers`, publish-check.ts).
 */
import { CAST_SWAP_FACE_MASKING_DEFAULTS } from "@nodaro/shared/models"
import { boxOf, erasedMarksOf, faceMaskingOn, faceMaskingSourceOf, type MaskEraseBox } from "../../../lib/cast-swap-face-masking.js"
import { faceMaskBaseKey, stableJson } from "./face-mask.js"
import { makeOutlinesOf } from "./role-outlines.js"
import { shownChips } from "./schemas.js"
import type { Choice, TrendSlot, TrendVersionData } from "./types.js"

/** The boxes `storedFaceMask` carries for a mixed run (`roleFaceStoredMask`). */
export interface RoleFaceRemake {
  raw?: { url: string; depthUrl?: string }
  erase?: MaskEraseBox[]
  roleBoxes?: Array<{ role: number; boxes: MaskEraseBox[] }>
}

type PersonSlot = Extract<TrendSlot, { kind: "person" }>

const isPerson = (slot: TrendSlot): slot is PersonSlot => slot.kind === "person"

/** Whether a person slot offers the Face chip to people (it lists "face" in `chips`). */
export function slotOffersFace(slot: TrendSlot): boolean {
  return isPerson(slot) && shownChips(slot).includes("face")
}

/** Whether a slot's runs can keep the person's own face: its Face default is "original", or it offers the chip. */
export function slotMayKeepFace(slot: TrendSlot): boolean {
  return isPerson(slot) && (slot.defaults?.face === "original" || slotOffersFace(slot))
}

/** Whether a trend's runs can send `face: "original"` (an engine must then declare `castSwap.roleFace`). */
export function trendMayKeepFaces(data: Pick<TrendVersionData, "slots">): boolean {
  return data.slots.some(slotMayKeepFace)
}

/**
 * The Face chip as a trend stores it, per person slot (its default, and
 * whether it offers it), as stable text; "" when no slot stores it. Any of it
 * is a key an older platform's strict slot schema refuses.
 */
export function faceChipKey(data: Pick<TrendVersionData, "slots"> | undefined): string {
  const stored = (data?.slots ?? []).flatMap((slot) => {
    if (!isPerson(slot)) return []
    const face: Choice | undefined = slot.defaults?.face
    const offered = (slot.chips ?? []).includes("face")
    return face === undefined && !offered ? [] : [{ slot: slot.key, ...(face ? { face } : {}), ...(offered ? { offered: true } : {}) }]
  })
  return stored.length === 0 ? "" : stableJson(stored)
}

/** Whether a trend stores the Face chip anywhere (`faceChipKey`). */
export function faceChipStored(data: Pick<TrendVersionData, "slots"> | undefined): boolean {
  return faceChipKey(data) !== ""
}

/** A run's role as compose.ts sends it: its kind, its pictures, and its Face chip when chosen. */
interface RunRole {
  readonly kind: string
  readonly images: readonly unknown[]
  readonly face?: Choice
}

/** Whether a run keeps any role's own face (`face: "original"`). */
export function keepsAnyFace(roles: readonly RunRole[]): boolean {
  return roles.some((r) => r.kind === "person" && r.face === "original")
}

/**
 * Whether a run mixes faces: some person keeps their own ("original") while
 * a pictured person takes a new one (no `face`, or "new").
 */
export function mixesFaces(roles: readonly RunRole[]): boolean {
  return keepsAnyFace(roles) && roles.some((r) => r.kind === "person" && r.images.length > 0 && r.face !== "original")
}

/**
 * What a mixed run on the trend's approved stored mask sends beside it
 * (`RoleFaceRemake`): only what the trend kept, each part left out when it is
 * not there (no raw mask from the current base, no erased marks, no role
 * outlines). Role N is the Nth slot (a run sends one role per slot, in order).
 * New objects.
 */
export function roleFaceRemakeFor(data: Pick<TrendVersionData, "source" | "faceMasking" | "faceMask" | "slots">): RoleFaceRemake {
  const out: RoleFaceRemake = {}
  const mask = data.faceMask
  const base = faceMaskBaseKey(data)
  const fill = data.faceMasking?.fill ?? CAST_SWAP_FACE_MASKING_DEFAULTS.fill
  if (mask?.rawMaskUrl && base !== null && mask.baseKey === base && (fill !== "depth" || mask.depthUrl)) {
    out.raw = { url: mask.rawMaskUrl, ...(fill === "depth" ? { depthUrl: mask.depthUrl! } : {}) }
  }
  const erase = erasedMarksOf(data.faceMasking).map(boxOf)
  if (erase.length > 0) out.erase = erase
  const roleBoxes = makeOutlinesOf(data).flatMap((o) => {
    const i = data.slots.findIndex((s) => s.key === o.slot)
    return i < 0 || o.boxes.length === 0 ? [] : [{ role: i + 1, boxes: o.boxes.map(boxOf) }]
  })
  if (roleBoxes.length > 0) out.roleBoxes = roleBoxes
  return out
}

/**
 * Whether a trend hides faces with a stored mask (`faceMasking` on, source "faces"): the only clip preparation whose
 * mask has role outlines and keeps its raw mask, so the only one whose mixed runs the publish check can vouch for. A
 * depth preparation (full depth, keep people) is left to the engine.
 */
export function facesHiddenMask(data: Pick<TrendVersionData, "faceMasking">): boolean {
  return faceMaskingOn(data.faceMasking) && faceMaskingSourceOf(data.faceMasking) === "faces"
}

/**
 * The person slots whose mixed runs on a stored mask would be refused for
 * want of their own boxes: a faces-hidden trend (`facesHiddenMask`) with at least two person slots
 * (one can keep its face while another takes a new one), and a slot that can
 * keep its face with no role outline of its own (`makeOutlinesOf`: role
 * outlines on, and marks of that slot). In slot order.
 */
export function faceSlotsWithoutOutlines(data: Pick<TrendVersionData, "slots" | "faceMasking">): string[] {
  if (!facesHiddenMask(data)) return []
  const people = data.slots.filter(isPerson)
  if (people.length < 2) return []
  const outlined = new Set(makeOutlinesOf(data).map((o) => o.slot))
  return people.filter((s) => slotMayKeepFace(s) && !outlined.has(s.key)).map((s) => s.key)
}
