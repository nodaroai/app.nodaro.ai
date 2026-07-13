import { useQuery, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getVoices, searchVoiceLibrary, type ElevenLabsVoice, type VoiceLibraryParams } from "@/lib/api"
import { TTS_VOICES } from "@/lib/tts-voices"

const STALE_TIME = 6 * 60 * 60 * 1000 // 6 hours
const GC_TIME = 24 * 60 * 60 * 1000 // 24 hours
const LIBRARY_STALE_TIME = 5 * 60 * 1000 // 5 minutes

/** Rows fetched per Voice Library page — the infinite query's initial window and
 *  each subsequent sentinel-triggered fetch. Kept ≤ the backend's page_size clamp
 *  (100). The VCP client mirrors this same page size against `/v1/voices/library`. */
export const LIBRARY_PAGE_SIZE = 30

/** Filters accepted by the Voice Library — every param EXCEPT pagination, which the
 *  infinite query owns (`page` is the pageParam, `page_size` is LIBRARY_PAGE_SIZE). */
export type VoiceLibraryFilters = Omit<VoiceLibraryParams, "page" | "page_size">

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

/**
 * Voice Library (shared/community voices) as an INFINITE query. Pages accumulate
 * — `data.pages.flatMap(p => p.voices)` is the full loaded window — so the picker
 * can extend the list with an IntersectionObserver sentinel instead of a
 * "Load more" button that replaced the visible page. `page` is NOT part of the
 * query key: it is the pageParam, so pages stack within a single cache entry.
 * Changing any FILTER changes the key and starts a fresh query at page 0.
 *
 * Backend contract (`GET /v1/voices/library`, unchanged): accepts the filters +
 * `page` (0-based) + `page_size`, returns `{ voices, hasMore }`. `hasMore` on the
 * last loaded page decides whether a next page exists.
 */
export function useVoiceLibraryInfinite(filters: VoiceLibraryFilters, enabled: boolean) {
  const cacheParams: Record<string, string | undefined> = {
    search: filters.search,
    gender: filters.gender,
    age: filters.age,
    accent: filters.accent,
    language: filters.language,
    category: filters.category,
    use_cases: filters.use_cases,
    descriptives: filters.descriptives,
    featured: filters.featured,
    sort: filters.sort,
  }
  return useInfiniteQuery({
    queryKey: queryKeys.voices.library(cacheParams),
    queryFn: ({ pageParam }) =>
      searchVoiceLibrary({ ...filters, page: pageParam, page_size: LIBRARY_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length : undefined),
    staleTime: LIBRARY_STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: keepPreviousData,
    enabled,
  })
}
