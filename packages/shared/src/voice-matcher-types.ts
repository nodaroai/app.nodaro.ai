import { z } from "zod"

/**
 * Voice Matcher (LLM spec §7.1) picks an ElevenLabs voice per dialogue-bearing
 * cast member. Two variants discriminated by `voice_source`:
 *   - 'premade'  → uses a catalog voice_id
 *   - 'custom'   → emits a prompt for ElevenLabs voice_design (used when no
 *                  premade fits)
 *
 * **Schema shape note:** this was originally `z.discriminatedUnion(...)` but
 * Anthropic's tool input_schema validator rejects union-at-root JSON Schemas —
 * it requires `"type": "object"` at the top level (`tools.0.custom.input_schema.type:
 * Field required`). Flattening to a single object with both optional fields +
 * a `.refine()` produces a valid schema (root is an object) while still
 * enforcing the per-variant required-field rule at parse time. `callLLM`'s
 * schema.safeParse triggers a retry-with-feedback if the LLM emits an invalid
 * combination (e.g., 'premade' without voice_id), so the LLM converges on
 * correct output.
 */
export const VoiceMatchSchema = z
  .object({
    voice_source: z.enum(["premade", "custom"]),
    voice_id: z.string().min(1).optional(),
    voice_design_prompt: z.string().max(500).optional(),
    reasoning: z.string().max(500),
  })
  .refine(
    (v) =>
      v.voice_source === "premade"
        ? typeof v.voice_id === "string" && v.voice_id.length > 0
        : typeof v.voice_design_prompt === "string" && v.voice_design_prompt.length > 0,
    {
      message:
        "voice_id is required when voice_source='premade'; voice_design_prompt is required when voice_source='custom'",
    },
  )
export type VoiceMatch = z.infer<typeof VoiceMatchSchema>
