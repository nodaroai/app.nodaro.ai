import { STRUCTURAL_SECTIONS } from "@nodaro/shared"
import type { SheetSection, SheetFlavour, EntityKind } from "@nodaro/shared"
import type { ResolvedSection, ResolvedSwatch } from "./types.js"
import { resolvePanels, type EntityBuckets } from "./resolve-panels.js"
import { resolveMotionPanels } from "./resolve-motion-panels.js"
import { headingFor } from "./sheet-text.js"

export interface BuildCtx {
  title?: string
  metadata?: Record<string, string>
  notes?: string
  heroBuf?: Buffer
  palette: ResolvedSwatch[]
  buckets: EntityBuckets
  /** Pre-fetched panel buffers keyed by URL (the worker fetches them once). */
  panelBufByUrl: Record<string, Buffer>
}

/** Pure: ordered sections → ResolvedSection[] for the compositor. No I/O —
 *  panel buffers come from `panelBufByUrl`. Board sections re-run resolvePanels
 *  (per section) to find their panels in order; structural sections carry text. */
export function buildResolvedSections(
  sections: readonly SheetSection[], flavour: SheetFlavour, entityKind: EntityKind, c: BuildCtx,
): ResolvedSection[] {
  const out: ResolvedSection[] = []
  for (const section of sections) {
    if (section.kind === "header") {
      out.push({ kind: "header", title: c.title, metadata: c.metadata, hero: c.heroBuf })
    } else if (section.kind === "palette") {
      out.push({ kind: "palette", title: "COLOR PALETTE", swatches: c.palette })
    } else if (section.kind === "notes") {
      out.push({ kind: "notes", title: "NOTES", text: c.notes })
    } else if (STRUCTURAL_SECTIONS.has(section.kind)) {
      out.push({ kind: section.kind, title: section.subtitle })
    } else {
      const { present } = resolvePanels(entityKind, [section], flavour, c.buckets)
      const panels = present
        .map((p) => ({ image: c.panelBufByUrl[p.url], label: p.label }))
        .filter((p): p is { image: Buffer; label: string } => p.image instanceof Buffer)
      out.push({ kind: section.kind, title: section.subtitle ?? headingFor(section.kind), panels })
    }
  }
  return out
}

/** Context for the motion background — same chrome as BuildCtx minus the still
 *  panel buffers (board slots are filled by overlaid clips, not composited here). */
export interface MotionBgCtx {
  title?: string
  metadata?: Record<string, string>
  notes?: string
  heroBuf?: Buffer
  palette: ResolvedSwatch[]
  motionBucket: ReadonlyArray<{ name?: string; url?: string }>
}

/** Pure: the background ComposeInput sections for a MOTION sheet. Identical chrome
 *  to `buildResolvedSections` (header/palette/notes/structural), but each board
 *  section carries ONE empty-buffer placeholder per PRESENT motion clip (in
 *  resolveMotionPanels order), so `computeLayout`/`sheetSlots` allocate exactly
 *  one slot per present clip, in the SAME order as the clip URL list — which is
 *  what makes the Nth clip overlay into the Nth slot. Buffers are empty because
 *  background mode skips the panel composite (only chrome is drawn). Mirrors
 *  buildResolvedSections so the two can't drift. */
export function buildMotionBackgroundSections(
  sections: readonly SheetSection[], flavour: SheetFlavour, entityKind: EntityKind, c: MotionBgCtx,
): ResolvedSection[] {
  const out: ResolvedSection[] = []
  for (const section of sections) {
    if (section.kind === "header") {
      out.push({ kind: "header", title: c.title, metadata: c.metadata, hero: c.heroBuf })
    } else if (section.kind === "palette") {
      out.push({ kind: "palette", title: "COLOR PALETTE", swatches: c.palette })
    } else if (section.kind === "notes") {
      out.push({ kind: "notes", title: "NOTES", text: c.notes })
    } else if (STRUCTURAL_SECTIONS.has(section.kind)) {
      out.push({ kind: section.kind, title: section.subtitle })
    } else {
      // Per-section motion resolution (mirrors the still path's per-section
      // resolvePanels) — one slot per present clip, in plan order.
      const { present } = resolveMotionPanels(entityKind, [section], flavour, c.motionBucket)
      const panels = present.map((p) => ({ image: Buffer.alloc(0), label: p.label }))
      out.push({ kind: section.kind, title: section.subtitle ?? headingFor(section.kind), panels })
    }
  }
  return out
}
