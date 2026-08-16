// frontend/src/components/heygen/heygen-catalog.ts
//
// Single source of truth for the HeyGen catalog on the client:
//   • the two React Query definitions (avatars / voices) — the same key, the
//     same staleTime and the same polling rules everywhere they are consumed
//     (config-panel pickers, published-app cards, the on-node quick pick), so
//     a catalog fetched once serves every surface;
//   • the mapping from a picked avatar to the node-data patch it implies;
//   • the keyless-install copy shown when the catalog is empty.
//
// The catalog arrives PROGRESSIVELY. HeyGen pages it and a cold server fill
// takes tens of seconds, so the server answers with what it has plus
// `complete:false`; the query re-polls every couple of seconds until the list
// is whole. Consumers render whatever has arrived — the first page shows in
// about a second and the rest streams in behind it.
//
// Anything that reads the HeyGen catalog goes through this file — a second
// hand-written `useQuery({ queryKey: ["heygen-avatars"] … })` would drift on
// the polling rules and silently split the cache.

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import {
  getHeygenAvatarCatalog,
  getHeygenVoiceCatalog,
  type HeygenAvatar,
  type HeygenCatalogPage,
  type HeygenCatalogSince,
  type HeygenVoice,
} from "@/lib/api"
import type { AiAvatarData } from "@/types/nodes"

export const HEYGEN_AVATARS_QUERY_KEY = ["heygen-avatars"] as const
export const HEYGEN_VOICES_QUERY_KEY = ["heygen-voices"] as const

/** The catalogs change rarely; the server caches them for an hour anyway. */
const CATALOG_STALE_TIME_MS = 5 * 60 * 1000

/** While the server is still filling, ask again this often. */
const FILLING_POLL_MS = 2_000

/**
 * An EMPTY catalog is a state that changes under the user — a self-host that
 * pastes its HeyGen key or connects nodaro.ai (the catalog then arrives through
 * the connection) should see every picker fill without a reload. Cheap: the
 * server answers from memory.
 */
const EMPTY_POLL_MS = 15_000

/** What the query cache holds for a catalog: everything received so far. */
export interface HeygenCatalogState<T> {
  readonly items: T[]
  readonly complete: boolean
  /** The server generation these items belong to ("" from a server that
   *  predates deltas — then every poll brings the whole list). */
  readonly generation: string
}

/**
 * Polling rule shared by both catalogs:
 *   still filling with pages in hand → every 2 s (the rest is streaming in);
 *   nothing yet (empty, or a fill that has not produced a page) → every 15 s;
 *   whole and non-empty → stop.
 */
export function catalogRefetchInterval(state: HeygenCatalogState<unknown> | undefined): number | false {
  if (!state) return false
  if (state.items.length === 0) return EMPTY_POLL_MS
  return state.complete ? false : FILLING_POLL_MS
}

function refetchRule(query: { state: { data?: HeygenCatalogState<unknown> } }): number | false {
  return catalogRefetchInterval(query.state.data)
}

/**
 * Fold one server answer onto what the cache already holds. The server sends
 * a DELTA when asked with the previous `{ offset, generation }`: same
 * generation at exactly our offset → append; anything else (a new fill, a
 * restarted server, an old server that ignores the params) → take the answer
 * as the whole list. Pure, so the merge rule is unit-tested.
 */
export function mergeCatalogPage<T>(
  prev: HeygenCatalogState<T> | undefined,
  page: HeygenCatalogPage<T>,
): HeygenCatalogState<T> {
  const appends =
    !!prev &&
    prev.generation !== "" &&
    page.generation === prev.generation &&
    page.offset === prev.items.length
  return {
    items: appends ? [...prev.items, ...page.items] : page.items,
    complete: page.complete,
    generation: page.generation,
  }
}

/** The `since` to send for the next poll — only when we hold a real generation. */
function sinceOf<T>(prev: HeygenCatalogState<T> | undefined): HeygenCatalogSince | undefined {
  return prev && prev.generation ? { offset: prev.items.length, generation: prev.generation } : undefined
}

function catalogQueryOptions<T>(
  client: QueryClient,
  queryKey: readonly [string],
  fetchPage: (since?: HeygenCatalogSince) => Promise<HeygenCatalogPage<T>>,
) {
  return {
    queryKey,
    queryFn: async (): Promise<HeygenCatalogState<T>> => {
      const prev = client.getQueryData<HeygenCatalogState<T>>(queryKey)
      return mergeCatalogPage(prev, await fetchPage(sinceOf(prev)))
    },
    staleTime: CATALOG_STALE_TIME_MS,
    refetchInterval: refetchRule,
  }
}

export function heygenAvatarsQueryOptions(client: QueryClient) {
  return catalogQueryOptions<HeygenAvatar>(client, HEYGEN_AVATARS_QUERY_KEY, getHeygenAvatarCatalog)
}

export function heygenVoicesQueryOptions(client: QueryClient) {
  return catalogQueryOptions<HeygenVoice>(client, HEYGEN_VOICES_QUERY_KEY, getHeygenVoiceCatalog)
}

/** What a catalog consumer gets: the items so far + the loading facts. */
export interface HeygenCatalogQuery<T> {
  /** Items known so far (a stable empty array before the first answer). */
  readonly data: T[]
  /** No answer yet — OR the server is filling and has not produced a page
   *  (an empty answer that is not `complete` is still "loading", never
   *  "no avatars"). */
  readonly isLoading: boolean
  readonly isError: boolean
  /** False while the server is still streaming pages in. */
  readonly complete: boolean
}

const EMPTY: never[] = []

function shape<T>(q: {
  data: HeygenCatalogState<T> | undefined
  isLoading: boolean
  isError: boolean
}): HeygenCatalogQuery<T> {
  const items = q.data?.items ?? EMPTY
  const complete = q.data?.complete ?? false
  return {
    data: items,
    isLoading: q.isLoading || (!!q.data && items.length === 0 && !complete),
    isError: q.isError,
    complete,
  }
}

/** The HeyGen avatar catalog (photo-avatar looks). `[]` on a keyless install. */
export function useHeygenAvatars(): HeygenCatalogQuery<HeygenAvatar> {
  const client = useQueryClient()
  return shape(useQuery(heygenAvatarsQueryOptions(client)))
}

/** The HeyGen voice catalog. `[]` on a keyless install. */
export function useHeygenVoices(): HeygenCatalogQuery<HeygenVoice> {
  const client = useQueryClient()
  return shape(useQuery(heygenVoicesQueryOptions(client)))
}

/** Returns true when the avatar's `supportedEngines` list includes "avatar_v"
 *  (HeyGen's canonical engine ID — note underscore, not hyphen). */
export function avatarSupportsV(avatar: HeygenAvatar): boolean {
  return avatar.supportedEngines?.includes("avatar_v") ?? false
}

// ---------------------------------------------------------------------------
// Catalog filtering — ONE implementation for the settings-panel picker, the
// published-app card and the on-node search, so "search" means the same thing
// everywhere (name substring, case-insensitive).
// ---------------------------------------------------------------------------

/** Derive the sorted list of unique genders present in the catalog. */
export function deriveGenders(avatars: readonly HeygenAvatar[]): string[] {
  const seen = new Set<string>()
  for (const a of avatars) {
    if (a.gender) seen.add(a.gender.toLowerCase())
  }
  return Array.from(seen).sort()
}

/** Return `true` when `groupId` distinguishes stock vs. custom avatars. */
export function hasGroupSegmentation(avatars: readonly HeygenAvatar[]): boolean {
  return avatars.some((a) => a.groupId != null && a.groupId !== "")
}

/** Filter the avatar list by the active search + gender + segment + Avatar-V controls. */
export function filterAvatars(
  avatars: readonly HeygenAvatar[],
  query: string,
  gender: string,
  segment: "all" | "stock" | "custom",
  onlyAvatarV = false,
): HeygenAvatar[] {
  const q = query.trim().toLowerCase()
  return avatars.filter((a) => {
    if (q && !a.name.toLowerCase().includes(q)) return false
    if (gender !== "all" && a.gender.toLowerCase() !== gender) return false
    if (segment === "stock" && a.groupId) return false
    if (segment === "custom" && !a.groupId) return false
    if (onlyAvatarV && !avatarSupportsV(a)) return false
    return true
  })
}

/**
 * The node-data patch a picked voice implies — shared by the config panel and
 * the on-node voice popover so both write the same two fields.
 */
export function voiceSelectionPatch(voice: HeygenVoice): Partial<AiAvatarData> {
  return { voiceId: voice.voiceId, voiceName: voice.name }
}

/**
 * The exact copy every keyless-catalog state shows. One string, so the config
 * panel, the published-app card and the on-node quick pick can't paraphrase
 * each other — it is the community-edition "fails honestly" contract.
 */
export function keylessCatalogHint(what: "avatars" | "voices"): string {
  return `Add a HeyGen key or connect nodaro.ai under Integrations → Model providers to browse ${what}.`
}

/**
 * The node-data patch a picked catalog avatar implies. Used by the config panel
 * AND the on-node quick pick so the two write identical fields.
 *
 * - `avatarSupportsV` records whether the look supports Avatar V (drives the
 *   engine-mismatch warning). `supportedEngines` uses underscore ("avatar_v")
 *   per HeyGen's API. `undefined` when the catalog carries no engine metadata
 *   so the warning never fires on a guess.
 * - The voice is pre-filled from the avatar's default ONLY when the user has
 *   not already picked one — re-selecting an avatar never clobbers a voice.
 * - Aspect ratio follows the look's preferred orientation.
 */
export function avatarSelectionPatch(
  avatar: HeygenAvatar,
  currentVoiceId: string | undefined,
): Partial<AiAvatarData> {
  const supportsV =
    avatar.supportedEngines != null
      ? avatar.supportedEngines.includes("avatar_v")
      : undefined
  return {
    avatarId: avatar.avatarId,
    avatarName: avatar.name,
    avatarPreviewUrl: avatar.previewImageUrl,
    avatarGroupId: avatar.groupId ?? undefined,
    avatarSupportsV: supportsV,
    voiceId: currentVoiceId ?? avatar.defaultVoiceId ?? undefined,
    aspectRatio: avatar.preferredOrientation === "portrait" ? "9:16" : "16:9",
  }
}
