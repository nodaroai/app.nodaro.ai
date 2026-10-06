/**
 * KIE Gemini Omni character client.
 *
 * `POST /api/v1/omni/character/create` mints a `characterId` from a portrait
 * (+ optional body image) and a description. The id is what a Gemini Omni video
 * task takes as `character_ids` — the dedicated IDENTITY input, as opposed to
 * `image_urls`, which KIE documents as loose "reference images for characters,
 * scenes, styles, or storyboard guidance" and which does not hold a face.
 *
 * Contract (docs.kie.ai/market/gemini-omni-character.md): synchronous; body
 * `{ descriptions (required), image_urls: [portrait, body?], audio_ids?,
 * character_name? }`; response `{ code: 200, msg, data: { characterId, … } }`.
 * No price and no validity period are documented, so ids are CACHED (24h — a
 * deliberately conservative guess) and a stale one is recreated once by the
 * caller; see `isInvalidOmniCharacterError`.
 *
 * Voice persona: `POST /api/v1/omni/audio/create` (`gemini-omni-audio`) mints a
 * `kieAudioId` from one of 30 preset voices + an optional description / example
 * line. The id rides TWICE — in the character create's `audio_ids` (voice traits
 * for the character) and in the video task's `audio_ids` (so the persona drives
 * the speech, which is what keeps one voice across separate clips). Synchronous;
 * the envelope's success code is documented as `0` on this endpoint but `200` on
 * the character one, so BOTH are accepted.
 *
 * Own module, not `client.ts`: the shared client is mocked wholesale by every
 * Gemini provider test, and a character failure must never be able to hide in
 * that mock.
 */
import { createHash } from "node:crypto"
import { config } from "../../lib/config.js"
import { throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { providerFetch, readUserSafeMessage, type EgressMeta } from "../egress.js"
import { requireKieKey, createSanitizedError, KIE_API_BASE } from "./client.js"
import type { VideoCharacterReference, VideoCharacterVoice } from "@nodaro/shared"

/** KIE documents no validity period for a character id; 24h is a guess that
 *  trades a few redundant creates for never serving a long-dead id. */
export const OMNI_CHARACTER_CACHE_TTL_SEC = 24 * 60 * 60

const CACHE_KEY_PREFIX = "kie:omni-character:"
const AUDIO_CACHE_KEY_PREFIX = "kie:omni-audio:"
const CONTEXT = "Character creation"
const AUDIO_CONTEXT = "Voice creation"

/** Documented `name` ceiling of the audio-persona endpoint. */
const AUDIO_NAME_MAX = 210

/** The one place the wire field name for the description lives. KIE's schema
 *  says `descriptions` (required); its JSON example says `description`. The
 *  schema is the contract — flip here, and only here, if a live probe disagrees. */
const DESCRIPTION_FIELD = "descriptions"

// ---------------------------------------------------------------------------
// Id cache
// ---------------------------------------------------------------------------

export interface OmniCharacterStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSec: number): Promise<void>
  del(key: string): Promise<void>
}

/** Redis-backed store, loaded lazily: this module sits under `video.ts`, which
 *  a dozen unit tests import WITHOUT mocking the queue — a top-level
 *  `lib/queue.js` import would open a Redis connection in every one of them. */
const redisStore: OmniCharacterStore = {
  async get(key) {
    const { redis } = await import("../../lib/queue.js")
    return redis.get(key)
  },
  async set(key, value, ttlSec) {
    const { redis } = await import("../../lib/queue.js")
    await redis.set(key, value, "EX", ttlSec)
  },
  async del(key) {
    const { redis } = await import("../../lib/queue.js")
    await redis.del(key)
  },
}

/** In-process fallback (LRU by insertion order) for when Redis is unreachable. */
const MEMORY_MAX = 500
const memory = new Map<string, { id: string; expiresAt: number }>()

const memoryStore: OmniCharacterStore = {
  async get(key) {
    const hit = memory.get(key)
    if (!hit) return null
    if (hit.expiresAt <= Date.now()) {
      memory.delete(key)
      return null
    }
    // refresh recency
    memory.delete(key)
    memory.set(key, hit)
    return hit.id
  },
  async set(key, value, ttlSec) {
    memory.delete(key)
    memory.set(key, { id: value, expiresAt: Date.now() + ttlSec * 1000 })
    while (memory.size > MEMORY_MAX) {
      const oldest = memory.keys().next().value
      if (oldest === undefined) break
      memory.delete(oldest)
    }
  },
  async del(key) {
    memory.delete(key)
  },
}

let injectedStore: OmniCharacterStore | null = null

/** Test seam: replace the Redis store. `null` restores the default. */
export function setOmniCharacterStore(store: OmniCharacterStore | null): void {
  injectedStore = store
}
export function _resetOmniCharacterMemoryForTests(): void {
  memory.clear()
}

/** A cache operation can never fail a generation: any store error degrades to
 *  the in-process map (and ultimately to a plain create). */
async function cacheGet(key: string): Promise<string | null> {
  try {
    return await (injectedStore ?? redisStore).get(key)
  } catch (err) {
    console.warn("[KIE.ai] omni-character cache read failed; falling back to in-process:", (err as Error)?.message)
    return memoryStore.get(key)
  }
}
async function cacheSet(key: string, id: string): Promise<void> {
  try {
    await (injectedStore ?? redisStore).set(key, id, OMNI_CHARACTER_CACHE_TTL_SEC)
  } catch (err) {
    console.warn("[KIE.ai] omni-character cache write failed; using in-process:", (err as Error)?.message)
    await memoryStore.set(key, id, OMNI_CHARACTER_CACHE_TTL_SEC)
  }
}

/** Stable key over everything that defines the minted character. It covers the
 *  URLs, not the bytes behind them: a mutable URL whose image changes within the
 *  TTL serves the previously minted face until the entry expires — send a fresh
 *  URL (or change the description/name) to force a new character. */
export function omniCharacterCacheKey(ref: VideoCharacterReference): string {
  const parts: unknown[] = [ref.imageUrl, ref.bodyImageUrl ?? "", ref.description, ref.name ?? ""]
  // A voice only ever ADDS a dimension: an unvoiced reference keeps the key it
  // always had, and a voiced and an unvoiced character can never share an id —
  // the minted character carries its voice traits (`audio_ids`) inside KIE.
  if (ref.voice) parts.push([ref.voice.preset, ref.voice.description ?? "", ref.voice.exampleLine ?? ""])
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex")
  return `${CACHE_KEY_PREFIX}${digest}`
}

/** The persona's display name: the character's own name, else `<preset> voice`. */
export function omniAudioPersonaName(ref: Pick<VideoCharacterReference, "name" | "voice">): string {
  return (ref.name ?? `${ref.voice?.preset ?? "preset"} voice`).slice(0, AUDIO_NAME_MAX)
}

/** Stable key over everything that defines the minted audio persona. */
export function omniAudioCacheKey(voice: VideoCharacterVoice, name: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([voice.preset, voice.description ?? "", voice.exampleLine ?? "", name]))
    .digest("hex")
  return `${AUDIO_CACHE_KEY_PREFIX}${digest}`
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

interface OmniEnvelope {
  code?: number
  msg?: string
  data?: Record<string, unknown> | null
}

/**
 * One synchronous KIE create call (character or audio persona): egress seam,
 * HTTP + envelope error mapping, and the `data` object back. Both endpoints
 * share this so a fix to error handling can never reach only one of them.
 * `label` words the internal error ("character create", "audio create") — KIE's
 * own words land on `internalDetails` only, never on the user-facing message.
 */
async function postOmniCreate(args: {
  operation: string
  path: string
  label: string
  context: string
  body: Record<string, unknown>
  meta: EgressMeta
}): Promise<Record<string, unknown>> {
  const { operation, path, label, context, body, meta } = args
  // Honored only BEFORE the external call — same rule as createKieTask.
  await throwIfJobCancelled()
  requireKieKey(context)
  const apiKey = config.KIE_API_KEY
  if (!apiKey) throw createSanitizedError("KIE_API_KEY is not configured", context)

  const response = await providerFetch(
    {
      provider: "kie",
      operation,
      modelKey: meta.modelKey,
      body,
      dimensions: meta.dimensions ?? {},
    },
    `${KIE_API_BASE}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    },
  )

  const text = await response.text()
  if (!response.ok) {
    throw createSanitizedError(
      `${label} failed: ${response.status} - ${text}`,
      context,
      false,
      false,
      { userSafeMessage: readUserSafeMessage(response), upstreamStatus: response.status },
    )
  }

  let parsed: OmniEnvelope
  try {
    parsed = JSON.parse(text) as OmniEnvelope
  } catch {
    throw createSanitizedError(`${label} response is not valid JSON: ${text}`, context)
  }
  // 0 (audio doc) and 200 (character doc) are both documented successes.
  if (parsed.code !== undefined && parsed.code !== 0 && parsed.code !== 200) {
    throw createSanitizedError(
      `${label} error (code ${parsed.code}): ${parsed.msg ?? JSON.stringify(parsed)}`,
      context,
      false,
      false,
      { upstreamStatus: parsed.code },
    )
  }
  return (parsed.data ?? {}) as Record<string, unknown>
}

/**
 * Create one audio persona and return its `kieAudioId`. Throws a sanitized
 * `KieError` on ANY failure — a voiced character never silently degrades to an
 * unvoiced one. `meta.modelKey` must be OUR video model key, never defaulted.
 */
export async function createOmniAudio(voice: VideoCharacterVoice, name: string, meta: EgressMeta): Promise<string> {
  const data = await postOmniCreate({
    operation: "omni.audio.create",
    path: "/api/v1/omni/audio/create",
    label: "audio create",
    context: AUDIO_CONTEXT,
    meta,
    body: {
      audio_id: voice.preset,
      name,
      ...(voice.description ? { voice_description: voice.description } : {}),
      ...(voice.exampleLine ? { example_dialogue: voice.exampleLine } : {}),
    },
  })
  const id = data.kieAudioId
  if (typeof id !== "string" || !id) {
    throw createSanitizedError(`audio create response missing kieAudioId: ${JSON.stringify(data)}`, AUDIO_CONTEXT)
  }
  console.log("[KIE.ai] omni audio persona created")
  return id
}

/**
 * Create one character and return its `characterId`. Throws a sanitized
 * `KieError` on ANY failure — there is no fallback to image references (that is
 * the very behavior this input exists to replace). `meta.modelKey` must be OUR
 * video model key, threaded by the caller, never defaulted. `audioIds` are the
 * voice personas (from `createOmniAudio`) the character should carry.
 */
export async function createOmniCharacter(
  ref: VideoCharacterReference,
  meta: EgressMeta,
  audioIds: readonly string[] = [],
): Promise<string> {
  const data = await postOmniCreate({
    operation: "omni.character.create",
    path: "/api/v1/omni/character/create",
    label: "character create",
    context: CONTEXT,
    meta,
    body: {
      [DESCRIPTION_FIELD]: ref.description,
      image_urls: ref.bodyImageUrl ? [ref.imageUrl, ref.bodyImageUrl] : [ref.imageUrl],
      ...(audioIds.length ? { audio_ids: [...audioIds] } : {}),
      ...(ref.name ? { character_name: ref.name } : {}),
    },
  })
  const id = data.characterId
  if (typeof id !== "string" || !id) {
    throw createSanitizedError(`character create response missing characterId: ${JSON.stringify(data)}`, CONTEXT)
  }
  console.log("[KIE.ai] omni character created")
  return id
}

export interface ResolvedOmniCharacters {
  /** `character_ids` for the video task, in request order. */
  ids: string[]
  /**
   * Index-aligned: true when ANY id of that reference (its character OR its
   * voice persona) came from the cache — so a stale-id retry knows what to
   * recreate.
   */
  fromCache: boolean[]
  /** Voice-persona ids for the video task's `audio_ids`: de-duplicated, request order. */
  audioIds: string[]
}

/**
 * Resolve each reference to a `characterId` (and, when it carries a voice, a
 * `kieAudioId`): cache hit, else create + cache. Identical references inside one
 * call share one create. `force` skips the cache READ (and overwrites the entry)
 * — the recreate half of the stale-id retry.
 *
 * The audio persona is resolved for EVERY voiced reference, character cache hit
 * or not: the video request needs the id too (it is what makes the persona drive
 * the speech), and it is minted before the character because the character's
 * create takes it as `audio_ids`.
 */
export async function resolveOmniCharacterIds(
  refs: readonly VideoCharacterReference[],
  meta: EgressMeta,
  opts: { force?: boolean } = {},
): Promise<ResolvedOmniCharacters> {
  const keys = refs.map(omniCharacterCacheKey)
  const audioSettled = new Map<string, { id: string; fromCache: boolean }>()
  const settled = new Map<string, { id: string; fromCache: boolean }>()
  const audioKeyOf = (ref: VideoCharacterReference): string | null =>
    ref.voice ? omniAudioCacheKey(ref.voice, omniAudioPersonaName(ref)) : null
  // Sequential on purpose: each create is a paid-account call on OUR key and
  // the set is ≤ 3; parallelism would only multiply a burst on a failure.
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]!
    const aKey = audioKeyOf(ref)
    if (aKey && ref.voice && !audioSettled.has(aKey)) {
      const hit = opts.force ? null : await cacheGet(aKey)
      if (hit) {
        audioSettled.set(aKey, { id: hit, fromCache: true })
      } else {
        const id = await createOmniAudio(ref.voice, omniAudioPersonaName(ref), meta)
        await cacheSet(aKey, id)
        audioSettled.set(aKey, { id, fromCache: false })
      }
    }
    const key = keys[i]!
    if (settled.has(key)) continue
    if (!opts.force) {
      const hit = await cacheGet(key)
      if (hit) {
        settled.set(key, { id: hit, fromCache: true })
        continue
      }
    }
    const id = await createOmniCharacter(ref, meta, aKey ? [audioSettled.get(aKey)!.id] : [])
    await cacheSet(key, id)
    settled.set(key, { id, fromCache: false })
  }
  const audioIds: string[] = []
  for (const ref of refs) {
    const aKey = audioKeyOf(ref)
    const id = aKey ? audioSettled.get(aKey)!.id : null
    if (id && !audioIds.includes(id)) audioIds.push(id)
  }
  return {
    ids: keys.map((k) => settled.get(k)!.id),
    fromCache: refs.map((ref, i) => {
      const aKey = audioKeyOf(ref)
      return settled.get(keys[i]!)!.fromCache || (aKey !== null && audioSettled.get(aKey)!.fromCache)
    }),
    audioIds,
  }
}

/** Drop the cache entries for these references (after KIE rejected their ids). */
export async function forgetOmniCharacters(refs: readonly VideoCharacterReference[]): Promise<void> {
  const del = async (key: string): Promise<void> => {
    try {
      await (injectedStore ?? redisStore).del(key)
    } catch { /* best effort */ }
    await memoryStore.del(key)
  }
  for (const ref of refs) {
    await del(omniCharacterCacheKey(ref))
    // The voice persona goes too: a character recreated against a dead audio id
    // would be rejected for it, and the video request would re-send it.
    if (ref.voice) await del(omniAudioCacheKey(ref.voice, omniAudioPersonaName(ref)))
  }
}

/**
 * Does this error say KIE rejected a `character_ids` entry as invalid / unknown
 * / expired? Matches on `internalDetails` — `KieError.message` is SANITIZED and
 * never carries the provider's words. The wording is a GUESS (KIE documents no
 * such error), so the match is deliberately narrow and decides ONE recreate:
 *   A. the explicit id field (`character_ids` / `characterId` / `character id`)
 *      together with any invalid/missing/expired verdict, or
 *   B. the bare word `character` followed closely by an EXISTENCE verdict
 *      (not found / does not exist / expired) — never "invalid"/"unknown",
 *      which collide with prompt errors ("prompt contains invalid characters",
 *      "unknown character set", "invalid character in prompt").
 * A false negative costs one failed run (a dead cached id fails until its 24h
 * TTL ends or the entry is dropped); a false positive costs one extra create
 * and one extra task submission. Tighten from the first real prod observation.
 */
export function isInvalidOmniCharacterError(err: unknown): boolean {
  const details = (err as { internalDetails?: unknown } | null)?.internalDetails
  if (typeof details !== "string") return false
  const idField = /\bcharacter[_\s-]?ids?\b/i.test(details)
  if (idField && /\b(invalid|not found|not exist|does not exist|expired|unknown|no such)\b/i.test(details)) return true
  return /\bcharacter\b.{0,24}?\b(not found|does not exist|not exist|expired)\b/i.test(details)
}

/**
 * Does this error say KIE rejected an `audio_ids` entry as invalid / unknown /
 * expired? Same stance as `isInvalidOmniCharacterError`: matched on
 * `internalDetails`, deliberately narrow (the explicit id field `audio_ids` /
 * `audioId` / `audio id` WITH an existence verdict), because the wording is a
 * guess and a false positive costs one extra create and one extra submission —
 * while "invalid audio format" / "audio track too long" must never trigger it.
 */
export function isInvalidOmniAudioError(err: unknown): boolean {
  const details = (err as { internalDetails?: unknown } | null)?.internalDetails
  if (typeof details !== "string") return false
  return (
    /\baudio[_\s-]?ids?\b/i.test(details) &&
    /\b(invalid|not found|not exist|does not exist|expired|unknown|no such)\b/i.test(details)
  )
}
