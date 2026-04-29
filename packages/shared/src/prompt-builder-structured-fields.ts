/**
 * Path-1 structured prompt fields → composed prompt fragment.
 *
 * Used by:
 * - Nodaro's MCP server (Phase 6 v1.1) — generate_image / generate_video verbs
 *   accept these structured fields and run them through this helper before
 *   passing the composite prompt to the underlying route.
 * - (Optional) Frontend editor — same logic so the editor and MCP produce
 *   identical prompts for the same inputs.
 *
 * NOTE: this is a parallel utility to `prompt-builder.ts`. The latter does
 * image-specific composition (character/template/reference handling), while
 * this module handles the Path-1 structured-field shape that MCP verbs accept
 * (free-form strings under person/styling/setting/camera/lens/mood). Existing
 * frontend `buildPersonHints` / `buildStylingHints` helpers operate on catalog
 * IDs and are not interchangeable with this renderer.
 */

export interface StructuredPromptFields {
  person?: {
    age?: number
    gender?: "man" | "woman" | "child" | "non-binary"
    hair?: string
    eyes?: string
    expression?: string
    profession?: string
    warriorType?: string
  }
  styling?: {
    mood?: string
    lighting?: string
    aesthetic?: string
    colorLook?: string
  }
  setting?: {
    era?: string
    atmosphere?: string
    backdrop?: string
  }
  camera?: {
    framing?: string
    motion?: string
    format?: string
  }
  lens?: {
    focalLength?: string
    aperture?: string
  }
  /** Standalone shorthand mood (overrides styling.mood if both are set). */
  mood?: string
}

/**
 * Render structured fields → composite prompt fragment to be appended to the
 * user's free-text prompt. Returns "" if no fields populated.
 */
export function renderStructuredFields(fields: StructuredPromptFields): string {
  const parts: string[] = []
  if (fields.person) parts.push(renderPerson(fields.person))
  if (fields.styling) parts.push(renderStyling(fields.styling))
  if (fields.setting) parts.push(renderSetting(fields.setting))
  if (fields.camera) parts.push(renderCamera(fields.camera))
  if (fields.lens) parts.push(renderLens(fields.lens))
  if (fields.mood) parts.push(`Mood: ${fields.mood}.`)
  return parts.filter((s) => s.length > 0).join(" ")
}

function renderPerson(p: NonNullable<StructuredPromptFields["person"]>): string {
  const bits: string[] = []
  if (p.age) bits.push(`${p.age} years old`)
  if (p.gender) bits.push(p.gender)
  if (p.profession) bits.push(p.profession)
  if (p.warriorType) bits.push(`(${p.warriorType})`)
  if (p.hair) bits.push(`with ${p.hair} hair`)
  if (p.eyes) bits.push(`${p.eyes} eyes`)
  if (p.expression) bits.push(`${p.expression} expression`)
  return bits.length > 0 ? `Subject: ${bits.join(", ")}.` : ""
}

function renderStyling(s: NonNullable<StructuredPromptFields["styling"]>): string {
  const bits: string[] = []
  if (s.mood) bits.push(`mood ${s.mood}`)
  if (s.lighting) bits.push(`${s.lighting} lighting`)
  if (s.aesthetic) bits.push(`${s.aesthetic} aesthetic`)
  if (s.colorLook) bits.push(`${s.colorLook} color`)
  return bits.length > 0 ? `Style: ${bits.join(", ")}.` : ""
}

function renderSetting(s: NonNullable<StructuredPromptFields["setting"]>): string {
  const bits: string[] = []
  if (s.era) bits.push(`${s.era} era`)
  if (s.atmosphere) bits.push(`${s.atmosphere} atmosphere`)
  if (s.backdrop) bits.push(`set in ${s.backdrop}`)
  return bits.length > 0 ? `Setting: ${bits.join(", ")}.` : ""
}

function renderCamera(c: NonNullable<StructuredPromptFields["camera"]>): string {
  const bits: string[] = []
  if (c.framing) bits.push(`${c.framing} framing`)
  if (c.motion) bits.push(c.motion)
  if (c.format) bits.push(`${c.format} format`)
  return bits.length > 0 ? `Camera: ${bits.join(", ")}.` : ""
}

function renderLens(l: NonNullable<StructuredPromptFields["lens"]>): string {
  const bits: string[] = []
  if (l.focalLength) bits.push(l.focalLength)
  if (l.aperture) bits.push(`f/${l.aperture}`)
  return bits.length > 0 ? `Lens: ${bits.join(", ")}.` : ""
}
