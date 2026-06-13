/** Gen providers for the board: strict subset of IMAGE_GEN_PROVIDERS that
 *  renders legible in-image text + accepts reference conditioning. */
export const REFERENCE_BOARD_PROVIDERS = ["nano-banana-pro", "gpt-image-2"] as const
export type ReferenceBoardProvider = (typeof REFERENCE_BOARD_PROVIDERS)[number]

export type BoardEntityKind = "character" | "location" | "object"

export interface BoardTemplate {
  /** "<entityKind>/<slug>" */
  readonly id: string
  readonly entityKind: BoardEntityKind
  readonly label: string
  readonly build: (ctx: BoardPromptContext) => string
}

/** Optional metadata the resolver supplies from a connected entity. All
 *  optional — the prompt degrades gracefully (omits labels) when absent. */
export interface BoardPromptContext {
  readonly name?: string
  readonly description?: string
}

// ── Shared clauses (the three guide tricks) ──────────────────────────────
const ANTI_RIGID =
  "Editorial reference-board layout, dark near-black background, thin yellow neon accent light, " +
  "faint film-grain overlay, production-grade design UI. Organized but not rigidly locked: panels may " +
  "shift position from generation to generation while staying readable, balanced and premium. Works " +
  "cleanly in different aspect ratios without depending on a fixed left-column structure. All on-image labels in ENGLISH."
const PALETTE = "A COLOR PALETTE panel: 6 swatches with HEX codes derived from the dominant tones."
const CAPTION = (kind: string) =>
  `Bottom caption: "Use this ${kind} board as a visual reference for consistent depiction across all generations." ` +
  `Bottom-right tags: STYLE · Modern · Realistic · Cinematic. Style: photorealistic, no illustration. 8K, fine grain, cinematic color grading.`

const subj = (ctx: BoardPromptContext, fallback: string) =>
  ctx.description?.trim() ? ctx.description.trim() : fallback

// ── Character ────────────────────────────────────────────────────────────
const characterFullBoard = (ctx: BoardPromptContext): string =>
  `Create a single high-resolution, densely packed character reference sheet titled "CHARACTER BOARD" ` +
  `using the attached photo as the single source of truth for face, hair, eyes, skin tone and body proportions ` +
  `of ${subj(ctx, "the attached person")}. The same person appears in every panel — same age, same features. ${ANTI_RIGID} ` +
  `Include a large hero portrait + metadata block: NAME · AGE · HEIGHT · BUILD · HAIR · EYES · FEATURES · OUTFIT · CHARACTER · MOOD. ` +
  `Six panels: VIEWS (front · 3/4 · side · back) · EXPRESSIONS (5 headshots) · DETAILS (face/eyes, hand, outfit macro) · ` +
  `OUTFIT FLAT-LAYS (5 isolated product shots) · LIGHTING/MOOD (4 lighting setups) · ${PALETTE} ${CAPTION("character")}`

// ── Location ─────────────────────────────────────────────────────────────
const locationFullBoard = (ctx: BoardPromptContext): string =>
  `Create a single high-resolution, densely packed location reference sheet titled "LOCATION BOARD" ` +
  `using the attached photo as the single source of truth for architecture, atmosphere, lighting, materials and color ` +
  `of ${subj(ctx, "the attached location")}. The space is identical across every panel — same place, materials, era. ${ANTI_RIGID} ` +
  `Include a hero establishing shot + metadata block: NAME · TYPE · ERA · SCALE · ARCHITECTURE · MATERIALS · ATMOSPHERE · DEFAULT TIME · DEFAULT WEATHER · PURPOSE. ` +
  `Six panels: VIEWS (wide · mid · tight · alt · overhead) · TIME OF DAY (dawn · noon · dusk · night) · DETAILS (material, architectural) · ` +
  `SET DRESSING / PROPS (5 studies) · WEATHER/MOOD (clear · overcast · rain · fog) · ${PALETTE} ${CAPTION("location")}`

// ── Object ───────────────────────────────────────────────────────────────
const objectFullBoard = (ctx: BoardPromptContext): string =>
  `Create a single high-resolution, densely packed object reference sheet titled "OBJECT BOARD" ` +
  `using the attached photo as the single source of truth for shape, materials, finish and proportions ` +
  `of ${subj(ctx, "the attached object")}. The object is identical across every panel. ${ANTI_RIGID} ` +
  `Include a hero shot + metadata block: NAME · TYPE · SCALE · MATERIALS · FINISH · KEY FEATURES · FUNCTION · MOOD. ` +
  `Six panels: VIEWS (front · 3/4 · side · back · top) · MATERIALS (close studies) · DETAILS (key part macros) · ` +
  `VARIATIONS (color/finish options) · LIGHTING/MOOD (4 setups) · ${PALETTE} ${CAPTION("object")}`

const t = (entityKind: BoardEntityKind, slug: string, label: string, build: BoardTemplate["build"]): BoardTemplate =>
  ({ id: `${entityKind}/${slug}`, entityKind, label, build })

export const REFERENCE_BOARD_TEMPLATES: readonly BoardTemplate[] = [
  t("character", "full-board", "Full Board — hero + 6 panels + palette", characterFullBoard),
  t("location", "full-board", "Full Board — hero + 6 panels + palette", locationFullBoard),
  t("object", "full-board", "Full Board — hero + 6 panels + palette", objectFullBoard),
]

export function listBoardTemplates(kind: BoardEntityKind): BoardTemplate[] {
  return REFERENCE_BOARD_TEMPLATES.filter((x) => x.entityKind === kind)
}

export function buildBoardPrompt(templateId: string, ctx: BoardPromptContext): string {
  const tpl = REFERENCE_BOARD_TEMPLATES.find((x) => x.id === templateId)
  if (!tpl) throw new Error(`Unknown reference-board template: ${templateId}`)
  return tpl.build(ctx)
}
