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

import { useMemo } from "react"
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import {
  getHeygenAvatarCatalog,
  getHeygenPrivateAvatars,
  getHeygenVoiceCatalog,
  type HeygenAvatar,
  type HeygenCatalogPage,
  type HeygenCatalogSince,
  type HeygenVoice,
} from "@/lib/api"
import type { AiAvatarData } from "@/types/nodes"

export const HEYGEN_AVATARS_QUERY_KEY = ["heygen-avatars"] as const
export const HEYGEN_PRIVATE_AVATARS_QUERY_KEY = ["heygen-avatars-private"] as const
export const HEYGEN_VOICES_QUERY_KEY = ["heygen-voices"] as const

/** One request of a WARM list — the whole ≈7,000-look catalog would be one
 *  ≈4 MB answer; a chunk paints in a fraction of the time and the rest streams
 *  behind it (see catalogQueryOptions). */
export const CATALOG_CHUNK_SIZE = 1500

/** How many chunks one queryFn run pulls before handing back to the poll
 *  loop — bounds a single fetch cycle without stalling the stream. */
const CHUNKS_PER_RUN = 8

/**
 * Consecutive answers that REPLACED our list (a generation we did not hold)
 * before it was whole. One is normal — the server refreshed while we were
 * away. Two in a row means the servers behind the load balancer disagree
 * (replicas mid-convergence): chunking can never finish against a moving
 * target, so from then on the run asks for the WHOLE list in one answer,
 * which is complete whichever replica serves it.
 */
const MAX_GENERATION_FLIPS = 2

/** The account's own looks: a small list people expect to be fresh. */
const PRIVATE_POLL_MS = 2 * 60 * 1000

/** The catalogs change rarely; the server caches them for an hour anyway. */
const CATALOG_STALE_TIME_MS = 5 * 60 * 1000

/** While the server is still filling, ask again this often. */
const FILLING_POLL_MS = 2_000

/** Between chunks of a warm list — effectively "next tick". */
const CHUNK_POLL_MS = 50

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
  /** The server's list is whole (we may still be behind it — see `total`). */
  readonly complete: boolean
  /** How far the server's list goes; > items.length while chunks stream in. */
  readonly total: number
  /** The server generation these items belong to ("" from a server that
   *  predates deltas — then every poll brings the whole list). */
  readonly generation: string
  /** Consecutive generation replacements while still behind (see
   *  MAX_GENERATION_FLIPS); 0 once caught up. */
  readonly flips: number
}

/** Fewer items than the server has → keep pulling. */
export function isBehind(state: HeygenCatalogState<unknown>): boolean {
  return state.items.length < state.total
}

/**
 * Polling rule shared by both catalogs:
 *   still filling with pages in hand → every 2 s (the rest is streaming in);
 *   the server is whole but we hold a chunk of it → straight away;
 *   nothing yet (empty, or a fill that has not produced a page) → every 15 s;
 *   whole and caught up → stop.
 */
export function catalogRefetchInterval(state: HeygenCatalogState<unknown> | undefined): number | false {
  if (!state) return false
  if (state.items.length === 0) return state.complete ? EMPTY_POLL_MS : FILLING_POLL_MS
  if (!state.complete) return FILLING_POLL_MS
  return isBehind(state) ? CHUNK_POLL_MS : false
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
  const replaced = !appends && !!prev && prev.generation !== "" && page.generation !== prev.generation
  const items = appends ? [...prev.items, ...page.items] : page.items
  const total = Math.max(page.total, items.length)
  const caughtUp = items.length >= total
  return {
    items,
    complete: page.complete,
    total,
    generation: page.generation,
    flips: caughtUp ? 0 : replaced ? prev.flips + 1 : appends ? prev.flips : 0,
  }
}

/** The `since` to send for the next poll — only when we hold a real generation. */
function sinceOf<T>(prev: HeygenCatalogState<T> | undefined): HeygenCatalogSince | undefined {
  return prev && prev.generation ? { offset: prev.items.length, generation: prev.generation } : undefined
}

function catalogQueryOptions<T>(
  client: QueryClient,
  queryKey: readonly [string],
  fetchPage: (since?: HeygenCatalogSince, limit?: number, signal?: AbortSignal) => Promise<HeygenCatalogPage<T>>,
) {
  return {
    queryKey,
    // One run pulls up to CHUNKS_PER_RUN chunks, publishing each into the
    // cache as it lands so the pickers paint the first ≈1,500 looks while the
    // rest streams in. A server that is still filling answers with what it
    // has (the poll loop takes over at 2 s); a whole list arrives chunk by
    // chunk with no wait between them. The loop stops as soon as an answer
    // REPLACES the list (a generation we did not hold — see
    // MAX_GENERATION_FLIPS), and once the last picker unmounts (`signal`).
    queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<HeygenCatalogState<T>> => {
      const prev = client.getQueryData<HeygenCatalogState<T>>(queryKey)
      if ((prev?.flips ?? 0) >= MAX_GENERATION_FLIPS) {
        // Replicas disagree: one whole answer is complete whoever serves it.
        return mergeCatalogPage(prev, await fetchPage(undefined, undefined, signal))
      }
      const flipsBefore = prev?.flips ?? 0
      let state = mergeCatalogPage(prev, await fetchPage(sinceOf(prev), CATALOG_CHUNK_SIZE, signal))
      for (
        let i = 1;
        i < CHUNKS_PER_RUN && state.complete && isBehind(state) && state.flips === flipsBefore && !signal?.aborted;
        i++
      ) {
        // Progressive paint between chunks; the final return sets it again.
        client.setQueryData(queryKey, state)
        state = mergeCatalogPage(state, await fetchPage(sinceOf(state), CATALOG_CHUNK_SIZE, signal))
      }
      return state
    },
    staleTime: CATALOG_STALE_TIME_MS,
    refetchInterval: refetchRule,
  }
}

/** The account's own looks — small, whole, refreshed every couple of minutes
 *  while any picker is mounted; a keyless install (or an older server) yields []. */
export function heygenPrivateAvatarsQueryOptions() {
  return {
    queryKey: HEYGEN_PRIVATE_AVATARS_QUERY_KEY,
    queryFn: getHeygenPrivateAvatars,
    staleTime: 60 * 1000,
    refetchInterval: PRIVATE_POLL_MS,
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
  /** False while the server is still streaming pages in, or while we are
   *  still pulling chunks of a whole list. */
  readonly complete: boolean
}

const EMPTY: never[] = []

function shape<T>(q: {
  data: HeygenCatalogState<T> | undefined
  isLoading: boolean
  isError: boolean
}): HeygenCatalogQuery<T> {
  const items = q.data?.items ?? EMPTY
  const complete = !!q.data && q.data.complete && !isBehind(q.data)
  return {
    data: items,
    isLoading: q.isLoading || (!!q.data && items.length === 0 && !q.data.complete),
    isError: q.isError,
    complete,
  }
}

/**
 * The account's own looks first, then the presets — one list, no duplicates
 * (a look present in both keeps its private row: an older server still puts
 * private looks in the main list, and the private list is the fresher one).
 * Pure, so the merge is unit-tested.
 */
export function mergeOwnAndPresetAvatars(own: readonly HeygenAvatar[], presets: HeygenAvatar[]): HeygenAvatar[] {
  if (own.length === 0) return presets
  const ownIds = new Set(own.map((a) => a.avatarId))
  return [...own, ...presets.filter((a) => !ownIds.has(a.avatarId))]
}

/**
 * The HeyGen avatar catalog: the account's own looks (fresh, small) followed
 * by HeyGen's presets (big, streamed). `[]` on a keyless install.
 */
export function useHeygenAvatars(): HeygenCatalogQuery<HeygenAvatar> {
  const client = useQueryClient()
  const presets = shape(useQuery(heygenAvatarsQueryOptions(client)))
  const own = useQuery(heygenPrivateAvatarsQueryOptions())
  const ownItems = own.data ?? EMPTY
  const data = useMemo(() => mergeOwnAndPresetAvatars(ownItems, presets.data), [ownItems, presets.data])
  return {
    data,
    // The private list is optional garnish: it never gates loading or errors.
    isLoading: presets.isLoading,
    isError: presets.isError,
    complete: presets.complete,
  }
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

/** A look HeyGen can render today. The account's own looks show up while
 *  HeyGen is still building them (`status: "processing"`) or after it gave up
 *  (`"failed"`) — visible so the user sees them coming, but not pickable. */
export function avatarIsUsable(avatar: HeygenAvatar): boolean {
  return avatar.status === undefined
}

/** The tile badge for a look that is not (yet) usable; null when it is. */
export function avatarStatusLabel(avatar: HeygenAvatar): "Processing…" | "Failed" | null {
  if (avatar.status === "processing") return "Processing…"
  if (avatar.status === "failed") return "Failed"
  return null
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

/** True when the catalog says which looks are the account's own. Servers
 *  that predate the public/private split send no `ownership` at all. */
export function catalogHasOwnership(avatars: readonly HeygenAvatar[]): boolean {
  return avatars.some((a) => a.ownership !== undefined)
}

/**
 * Is this look the account's own (custom) rather than a HeyGen preset?
 * Prefers the server's `ownership`; without it (older server) falls back to
 * the historical `groupId` heuristic — which is wrong for the real catalog
 * (every preset carries a group_id too), which is why `ownership` exists.
 */
export function isCustomAvatar(a: HeygenAvatar, ownershipKnown: boolean): boolean {
  return ownershipKnown ? a.ownership === "private" : a.groupId != null && a.groupId !== ""
}

/** Return `true` when the catalog has both presets and the account's own
 *  looks — i.e. a Stock / Custom filter would split it. */
export function hasGroupSegmentation(avatars: readonly HeygenAvatar[]): boolean {
  const known = catalogHasOwnership(avatars)
  return avatars.some((a) => isCustomAvatar(a, known))
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
  const known = catalogHasOwnership(avatars)
  return avatars.filter((a) => {
    if (q && !a.name.toLowerCase().includes(q)) return false
    if (gender !== "all" && a.gender.toLowerCase() !== gender) return false
    if (segment === "stock" && isCustomAvatar(a, known)) return false
    if (segment === "custom" && !isCustomAvatar(a, known)) return false
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
