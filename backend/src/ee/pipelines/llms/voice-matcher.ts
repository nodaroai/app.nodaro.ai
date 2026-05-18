import type { SupabaseClient } from "@supabase/supabase-js"
import { VoiceMatchSchema, type VoiceMatch } from "@nodaro/shared"
import { callLLM } from "./call-llm.js"

/**
 * Static ElevenLabs premade voice catalog used by the Voice Matcher LLM.
 *
 * NOTE: The Nodaro codebase does not yet ship a shared `ELEVENLABS_VOICES`
 * registry. The live catalog is fetched at runtime from
 * `https://api.elevenlabs.io/v2/voices` in `backend/src/routes/voices.ts` and
 * cached for 6h; the only static fallback is `FALLBACK_VOICES` in that route
 * (shape: gender / accent / age + free-form description) and the minimal
 * `TTS_VOICES` in `frontend/src/lib/tts-voices.ts` (id + name only).
 *
 * To keep the matcher deterministic, prompt-cacheable, and decoupled from the
 * route-level cache, we embed a curated static catalog here using the richer
 * `{ voice_id, name, gender, age_bracket, accent, descriptors }` shape the
 * plan's prompt expects. Voice IDs + names mirror `FALLBACK_VOICES` in
 * `routes/voices.ts`; descriptor tags are summarized from ElevenLabs' public
 * voice metadata. When a shared `ELEVENLABS_VOICES` registry lands, swap this
 * constant for the import without touching the rest of the module.
 */
interface VoiceCatalogEntry {
  readonly voice_id: string
  readonly name: string
  readonly gender: "male" | "female" | "non-binary"
  readonly age_bracket: "young" | "middle_aged" | "old"
  readonly accent: string
  readonly descriptors: readonly string[]
}

const ELEVENLABS_VOICES: readonly VoiceCatalogEntry[] = [
  // Female voices
  { voice_id: "Alice",      name: "Alice",      gender: "female", age_bracket: "middle_aged", accent: "British",         descriptors: ["confident", "warm", "professional"] },
  { voice_id: "Aria",       name: "Aria",       gender: "female", age_bracket: "young",       accent: "American",        descriptors: ["expressive", "sassy", "youthful"] },
  { voice_id: "Charlotte",  name: "Charlotte",  gender: "female", age_bracket: "young",       accent: "English-Swedish", descriptors: ["seductive", "smooth", "intimate"] },
  { voice_id: "Jessica",    name: "Jessica",    gender: "female", age_bracket: "young",       accent: "American",        descriptors: ["popular", "playful", "warm"] },
  { voice_id: "Laura",      name: "Laura",      gender: "female", age_bracket: "young",       accent: "American",        descriptors: ["sunshine", "upbeat", "friendly"] },
  { voice_id: "Lily",       name: "Lily",       gender: "female", age_bracket: "young",       accent: "British",         descriptors: ["warm", "narrative", "gentle"] },
  { voice_id: "Matilda",    name: "Matilda",    gender: "female", age_bracket: "young",       accent: "American",        descriptors: ["friendly", "natural", "audiobook"] },
  { voice_id: "Rachel",     name: "Rachel",     gender: "female", age_bracket: "young",       accent: "American",        descriptors: ["calm", "narration", "default"] },
  { voice_id: "Sarah",      name: "Sarah",      gender: "female", age_bracket: "young",       accent: "American",        descriptors: ["soft", "professional", "news"] },

  // Male voices
  { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam",    gender: "male", age_bracket: "middle_aged", accent: "American",      descriptors: ["deep", "narration", "authoritative"] },
  { voice_id: "Bill",                 name: "Bill",    gender: "male", age_bracket: "old",         accent: "American",      descriptors: ["trustworthy", "documentary", "gravelly"] },
  { voice_id: "Brian",                name: "Brian",   gender: "male", age_bracket: "middle_aged", accent: "American",      descriptors: ["deep", "resonant", "narrator"] },
  { voice_id: "Callum",               name: "Callum",  gender: "male", age_bracket: "middle_aged", accent: "Transatlantic", descriptors: ["hoarse", "intense", "videogame"] },
  { voice_id: "Charlie",              name: "Charlie", gender: "male", age_bracket: "middle_aged", accent: "Australian",    descriptors: ["natural", "casual", "conversational"] },
  { voice_id: "Chris",                name: "Chris",   gender: "male", age_bracket: "middle_aged", accent: "American",      descriptors: ["casual", "natural", "everyman"] },
  { voice_id: "Daniel",               name: "Daniel",  gender: "male", age_bracket: "middle_aged", accent: "British",       descriptors: ["authoritative", "news", "deep"] },
  { voice_id: "Eric",                 name: "Eric",    gender: "male", age_bracket: "middle_aged", accent: "American",      descriptors: ["smooth", "classy", "warm"] },
  { voice_id: "George",               name: "George",  gender: "male", age_bracket: "middle_aged", accent: "British",       descriptors: ["warm", "raspy", "mature"] },
  { voice_id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry",   gender: "male", age_bracket: "young",       accent: "American",      descriptors: ["anxious", "expressive", "young"] },
  { voice_id: "Liam",                 name: "Liam",    gender: "male", age_bracket: "young",       accent: "American",      descriptors: ["articulate", "narration", "clear"] },
  { voice_id: "Roger",                name: "Roger",   gender: "male", age_bracket: "middle_aged", accent: "American",      descriptors: ["confident", "classy", "rich"] },
  { voice_id: "Will",                 name: "Will",    gender: "male", age_bracket: "young",       accent: "American",      descriptors: ["friendly", "approachable", "warm"] },

  // Non-binary
  { voice_id: "River",                name: "River",   gender: "non-binary", age_bracket: "young", accent: "American",      descriptors: ["calm", "thoughtful", "neutral"] },
]

const _REDACTED_PROMPT_11 = `[REDACTED — moved to private plugin, S9 extraction]`

// Compute once at module load — catalog is module-constant, JSON.stringify produces
// the same string every call. Also helps Anthropic prompt caching since the prefix
// is byte-identical across requests.
const _REDACTED_PROMPT_26 = `[REDACTED — moved to private plugin, S9 extraction]`

export interface RunVoiceMatcherArgs {
  supabase: SupabaseClient
  pipelineId: string
  stageId: string
  userId: string
  castKey: string
  castName: string
  visualDescription: string
  voiceProfile: string
}

export async function runVoiceMatcher(args: RunVoiceMatcherArgs): Promise<VoiceMatch> {
  const userPrompt = `CAST MEMBER:
- key: ${args.castKey}
- name: ${args.castName}
- visual_description: ${args.visualDescription}
- voice_profile: ${args.voiceProfile}

Recommend an ElevenLabs voice.`

  const result = await callLLM({
    supabase: args.supabase,
    pipelineId: args.pipelineId,
    stageId: args.stageId,
    userId: args.userId,
    role: "specialist",
    task: "voice_match",
    modelId: "claude-haiku-4-5",
    temperature: 0.3,
    systemPrompt: '[REDACTED]',
    userPrompt,
    schema: VoiceMatchSchema,
    maxRetries: 1,
  })
  return result.output
}
