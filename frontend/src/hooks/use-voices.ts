import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getVoices, searchVoiceLibrary, type ElevenLabsVoice, type VoiceLibraryParams } from "@/lib/api"
import { TTS_VOICES } from "@/lib/tts-voices"

const STALE_TIME = 6 * 60 * 60 * 1000 // 6 hours
const GC_TIME = 24 * 60 * 60 * 1000 // 24 hours
const LIBRARY_STALE_TIME = 5 * 60 * 1000 // 5 minutes

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

export function useVoiceLibrary(params: VoiceLibraryParams, enabled: boolean) {
  const cacheParams: Record<string, string | undefined> = {
    search: params.search,
    gender: params.gender,
    age: params.age,
    accent: params.accent,
    language: params.language,
    category: params.category,
    use_cases: params.use_cases,
    descriptives: params.descriptives,
    featured: params.featured,
    sort: params.sort,
    page: params.page !== undefined ? String(params.page) : undefined,
    page_size: params.page_size !== undefined ? String(params.page_size) : undefined,
  }
  return useQuery({
    queryKey: queryKeys.voices.library(cacheParams),
    queryFn: () => searchVoiceLibrary(params),
    staleTime: LIBRARY_STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: keepPreviousData,
    enabled,
  })
}
