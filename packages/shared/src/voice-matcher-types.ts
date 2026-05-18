import { z } from "zod"

/**
 * Voice Matcher (LLM spec §7.1) picks an ElevenLabs voice per dialogue-bearing cast member.
 * Two variants discriminated by voice_source:
 *   - 'premade'  → uses a catalog voice_id
 *   - 'custom'   → emits a prompt for ElevenLabs voice_design (used when no premade fits)
 */
export const VoiceMatchSchema = z.discriminatedUnion("voice_source", [
  z.object({
    voice_source: z.literal("premade"),
    voice_id: z.string().min(1),
    reasoning: z.string().max(500),
  }),
  z.object({
    voice_source: z.literal("custom"),
    voice_design_prompt: z.string().max(500),
    reasoning: z.string().max(500),
  }),
])
export type VoiceMatch = z.infer<typeof VoiceMatchSchema>
