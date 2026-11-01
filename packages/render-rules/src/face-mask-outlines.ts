/**
 * A trend's role outlines (decided 2026-11-01), the wire both the backend
 * (the trend's schema, its stored face mask, a run's `storedFaceMask`) and
 * the trend builder (the marks editor) read. Internal only: not an Apache
 * grant — the platform's own trend tooling, not a public API.
 *
 * With `faceMasking.roleOutlines` on, the stored face mask draws a coloured
 * ring just outside each person role's masked region, so the video model can
 * tell who is who in every shot (the prompt's `roleOutlines` part names each
 * colour's role). Which region is whose comes from the admin's slot marks:
 * a region whose bounding-box centre lies in one of a role's boxes on that
 * frame is that role's (the core `mask-outline` job).
 */
import { faceMaskMarkSlot, type FaceMaskMark } from "./face-mask-marks"

/**
 * The outline colours, in role order among the trend's PERSON slots (the
 * first person slot is magenta, the second yellow, …): saturated colours
 * that read on a blurred person and on a gray depth fill alike, with no blue
 * or green (the face mesh's colours). The renderer draws a 1 px black edge on
 * each side of every ring, so the white one reads on a light background too.
 * Six, the most person slots a trend has.
 */
export const ROLE_OUTLINE_PALETTE = [
  { name: "magenta", hex: "#FF00FF" },
  { name: "yellow", hex: "#FFE600" },
  { name: "red", hex: "#FF1F1F" },
  { name: "orange", hex: "#FF8A00" },
  { name: "white", hex: "#FFFFFF" },
  { name: "purple", hex: "#9B30FF" },
] as const

export type RoleOutlineColourName = (typeof ROLE_OUTLINE_PALETTE)[number]["name"]

/** What a colour is sent as: `#RRGGBB`, upper-case hex. */
export const ROLE_OUTLINE_COLOUR_RE = /^#[0-9A-F]{6}$/

/** A slot as the outlines read it: its key, its kind and whether it is required. */
export interface RoleOutlineSlot {
  readonly key: string
  readonly kind: string
  readonly required?: boolean
}

/**
 * The keys of the trend's person slots, in the trend's own slot order (role
 * order): the order the palette is handed out in.
 */
export function personSlotOrder(slots: readonly RoleOutlineSlot[]): string[] {
  return slots.filter((s) => s.kind === "person").map((s) => s.key)
}

/**
 * The outline colour of person slot `key` (`#RRGGBB`): the palette's entry
 * at its place among the trend's person slots. Null for a slot that is not a
 * person of this trend, or past the palette (never, while a trend has at most
 * six person slots).
 */
export function roleOutlineColour(slots: readonly RoleOutlineSlot[], key: string): string | null {
  const i = personSlotOrder(slots).indexOf(key)
  return i < 0 ? null : (ROLE_OUTLINE_PALETTE[i]?.hex ?? null)
}

/** The palette entry a colour is (`#RRGGBB`, any case), or null for a colour off the palette. */
export function roleOutlineColourName(hex: string): RoleOutlineColourName | null {
  const up = hex.toUpperCase()
  return ROLE_OUTLINE_PALETTE.find((c) => c.hex === up)?.name ?? null
}

/**
 * Whether a slot mark may name `slot` (decided 2026-11-01): any PERSON slot
 * while role outlines are on (a required person's boxes say whose outline a
 * region gets), else an OPTIONAL person only (the per-person mask variants,
 * decided 2026-10-27).
 */
export function slotMarkAllowed(slot: RoleOutlineSlot | undefined, roleOutlines: boolean): boolean {
  if (!slot || slot.kind !== "person") return false
  return roleOutlines || slot.required !== true
}

/** A box of an outline: a mark's box, its label dropped. */
export interface RoleOutlineBox {
  fromFrame: number
  toFrame: number
  leftPct: number
  topPct: number
  rightPct: number
  bottomPct: number
}

/** One role's outline as a stored face mask's make is sent it: the slot, its colour and its boxes. */
export interface RoleOutline {
  slot: string
  colour: string
  boxes: RoleOutlineBox[]
}

/**
 * Every person slot's outline, from its slot marks: one per person slot that
 * has at least one, in role order, each with its colour (`roleOutlineColour`)
 * and its boxes in the marks' order. A mark naming no person slot is skipped
 * (the trend schema refuses it). New objects.
 */
export function roleOutlinesOf(slots: readonly RoleOutlineSlot[], marks: readonly FaceMaskMark[]): RoleOutline[] {
  const out: RoleOutline[] = []
  for (const key of personSlotOrder(slots)) {
    const colour = roleOutlineColour(slots, key)
    if (colour === null) continue
    const boxes = marks
      .filter((m) => faceMaskMarkSlot(m) === key)
      .map(({ fromFrame, toFrame, leftPct, topPct, rightPct, bottomPct }) => ({ fromFrame, toFrame, leftPct, topPct, rightPct, bottomPct }))
    if (boxes.length > 0) out.push({ slot: key, colour, boxes })
  }
  return out
}
