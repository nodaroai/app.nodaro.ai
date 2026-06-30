import { z } from "zod"

/**
 * Single source of truth for blueprint parameter schemas and metadata.
 *
 * A "blueprint" is a named, parameterised shot-shape (e.g. kinetic-type-beats,
 * cta-morph-press). This module declares:
 *   - BLUEPRINT_IDS   — readonly tuple of all known blueprint ids
 *   - BlueprintId     — union type derived from that tuple
 *   - BLUEPRINT_PARAM_SCHEMAS — per-id Zod schemas (satisfies Record<BlueprintId, …>)
 *   - BLUEPRINT_META  — per-id metadata (roles, defaultDurationFrames, description)
 *   - validateBlueprintParams — single-call validate helper
 *
 * Beat roles MUST match the vocabulary in backend/skills/video-director/doctrine.md:
 *   hook | pain_point | product_intro | feature_showcase | benefit_highlight |
 *   social_proof | branding | cta
 */

export const BLUEPRINT_IDS = [
  "kinetic-type-beats",
  "dataviz-countup",
  "grid-card-assemble",
  "titlecard-reveal",
  "logo-assemble-lockup",
  "cta-morph-press",
] as const

export type BlueprintId = (typeof BLUEPRINT_IDS)[number]

/** Shared hex-color validator — accepts #RGB or #RRGGBB. */
const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color like #RRGGBB")

export const BLUEPRINT_PARAM_SCHEMAS = {
  /** 1–4 statement lines swap in by hard-cut/scale-pop; accent color for the payoff. */
  "kinetic-type-beats": z.object({
    lines: z.array(z.string().min(1)).min(1).max(4),
    accentColor: hexColor,
    bgColor: hexColor.optional(),
    invert: z.boolean().optional(),
  }),

  /** A big number counts up to a value with a label. */
  "dataviz-countup": z.object({
    value: z.number(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    label: z.string().min(1),
    sublabel: z.string().optional(),
    accentColor: hexColor.optional(),
  }),

  /** N text cards cascade-assemble into a grid with a staggered entrance. */
  "grid-card-assemble": z.object({
    items: z.array(z.object({ label: z.string().min(1) })).min(2).max(6),
    columns: z.number().int().min(1).max(4).optional(),
    accentColor: hexColor.optional(),
  }),

  /** One clean title (+ optional subtitle) revealed with one restrained move, then held. */
  "titlecard-reveal": z.object({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    motion: z.enum(["slide-up", "crossfade", "wipe"]).optional(),
  }),

  /** Brand word letters cascade/assemble into a centred lockup (+ optional tagline). */
  "logo-assemble-lockup": z.object({
    brand: z.string().min(1),
    tagline: z.string().optional(),
    accentColor: hexColor.optional(),
  }),

  /** A CTA button appears centred; a cursor decelerates in and presses it. */
  "cta-morph-press": z.object({
    label: z.string().min(1),
    sublabel: z.string().optional(),
    accentColor: hexColor.optional(),
  }),
} satisfies Record<BlueprintId, z.ZodTypeAny>

/**
 * Beat roles use the vocabulary from backend/skills/video-director/doctrine.md:
 *   hook | pain_point | product_intro | feature_showcase | benefit_highlight |
 *   social_proof | branding | cta
 *
 * Reconciliation from the brief's draft roles:
 *   "problem"      → "pain_point"
 *   "feature"      → "feature_showcase"
 *   "benefits"     → "benefit_highlight"
 *   "benefit"      → "benefit_highlight"
 *   "breather"     → dropped (not in doctrine vocabulary)
 *   "product-intro"→ "product_intro" (hyphen → underscore)
 *   "outro"        → "branding" (brand lockup is a branding beat, not a separate arc beat)
 */
export const BLUEPRINT_META: Record<
  BlueprintId,
  { roles: string[]; defaultDurationFrames: number; description: string }
> = {
  "kinetic-type-beats": {
    roles: ["hook"],
    defaultDurationFrames: 150,
    description:
      "1–4 statement lines swap in by hard-cut/scale-pop; final line lands a spring-pop payoff on an accent.",
  },
  "dataviz-countup": {
    roles: ["pain_point"],
    defaultDurationFrames: 240,
    description:
      "A big number counts up to a value with a label; numbers are the hero.",
  },
  "grid-card-assemble": {
    roles: ["feature_showcase", "benefit_highlight"],
    defaultDurationFrames: 180,
    description:
      "N text cards cascade-assemble into a grid with a staggered entrance.",
  },
  "titlecard-reveal": {
    roles: ["benefit_highlight"],
    defaultDurationFrames: 120,
    description:
      "One clean title (+ optional subtitle) revealed with one restrained move, then held.",
  },
  "logo-assemble-lockup": {
    roles: ["product_intro", "branding"],
    defaultDurationFrames: 180,
    description:
      "Brand word's letters cascade/assemble into a centered lockup (+ optional tagline).",
  },
  "cta-morph-press": {
    roles: ["cta"],
    defaultDurationFrames: 150,
    description:
      "A CTA button appears centered; a cursor decelerates in and presses it with compression + ripple feedback.",
  },
}

/**
 * Validate params for a blueprint id.
 *
 * Returns `{ ok: true, data }` on success or `{ ok: false, message }` on failure.
 * An unknown id is treated as a validation failure (not a thrown error).
 */
export function validateBlueprintParams(
  id: string,
  params: unknown,
): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  const schema = (BLUEPRINT_PARAM_SCHEMAS as Record<string, z.ZodTypeAny>)[id]
  if (!schema) {
    return {
      ok: false,
      message: `Unknown blueprint id "${id}". Known: ${BLUEPRINT_IDS.join(", ")}`,
    }
  }
  const r = schema.safeParse(params)
  if (!r.success) {
    return {
      ok: false,
      message: r.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    }
  }
  return { ok: true, data: r.data as Record<string, unknown> }
}
