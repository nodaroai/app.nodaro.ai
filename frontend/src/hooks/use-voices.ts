import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getVoices, type ElevenLabsVoice } from "@/lib/api"
import { TTS_VOICES } from "@/lib/tts-voices"

const STALE_TIME = 6 * 60 * 60 * 1000 // 6 hours
const GC_TIME = 24 * 60 * 60 * 1000 // 24 hours

/** Static fallback derived from TTS_VOICES */
const PLACEHOLDER_VOICES: ElevenLabsVoice[] = TTS_VOICES.map((v) => ({
  voice_id: "",
  name: v.id,
  preview_url: "",
  gender: "",
  accent: "",
  age: "",
  description: "",
  use_case: "",
  category: "premade",
}))

export function useVoices() {
  return useQuery({
    queryKey: queryKeys.voices.list(),
    queryFn: getVoices,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: PLACEHOLDER_VOICES,
  })
}
