import { z } from "zod"
import { SHEET_TYPES, SHEET_SKINS, SHEET_ASPECTS, OUTPUT_FORMATS, SECTION_KINDS, SHEET_BACKGROUNDS } from "@nodaro/shared"
import { safeUrlSchema } from "../lib/url-validator.js"

const entry = z.union([
  z.object({ kind: z.literal("preset"), variant: z.string().min(1).max(100) }),
  z.object({ kind: z.literal("custom"), label: z.string().min(1).max(60), prompt: z.string().min(1).max(500) }),
])
const section = z.object({
  kind: z.enum(SECTION_KINDS),
  board: z.string().max(40).optional(),
  subtitle: z.string().max(120).optional(),
  panelCount: z.number().int().min(0).max(24).optional(),
  entries: z.array(entry).max(12).optional(),
})
const flavour = z.object({
  outputFormat: z.enum(OUTPUT_FORMATS),
  withText: z.boolean(),
  showLabels: z.boolean(),
  aspect: z.enum(SHEET_ASPECTS),
  background: z.enum(SHEET_BACKGROUNDS),
  sections: z.array(section).max(16).optional(),
  // Studio preset id (character only) — labels the persisted sheet. A plain
  // z.object strips unknown keys, so this MUST be declared or it never reaches
  // the worker's verbatim-flavour snapshot. Inert to pricing/composition.
  presetId: z.enum(["studio-main", "studio-extended"]).optional(),
})
export const referenceSheetBody = z.object({
  type: z.enum(SHEET_TYPES),
  skin: z.enum(SHEET_SKINS),
  flavour,
  entityKind: z.enum(["character", "object", "location"]).optional(),
  entityDbId: z.string().uuid().optional(),
  imageUrl: safeUrlSchema.optional(),
  userId: z.string().uuid().optional(),
}).refine((b) => (b.entityKind && b.entityDbId) || b.imageUrl, {
  message: "Provide entityKind+entityDbId (entity mode) or imageUrl (raw-image mode)",
})
export type ReferenceSheetBody = z.infer<typeof referenceSheetBody>
