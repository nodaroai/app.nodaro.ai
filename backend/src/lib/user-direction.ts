/**
 * User-owned direction references, resolved — the ONE async step between a
 * generate-image request (or a Generate Image node in a workflow run) that names
 *   direction.colorLook = "palette:<id>"   (one of the caller's colour palettes)
 *   direction.style     = "moodboard:<id>" (one of the caller's moodboards)
 * and the synchronous assembly that folds it (`assembleImageInput`'s
 * `directionRefs` + `styleReferences`).
 *
 * Both lanes call `resolveUserDirection`: the route through
 * `userDirectionPreHandler` (BEFORE the credit guard, because a moodboard's
 * images change the reference count a run is priced by), the workflow engine
 * through `node-user-direction.ts` (before any jobs row). Pinned by
 * `__tests__/user-direction-lanes.test.ts`.
 *
 * A user-owned resource is never silently ignored — unlike a catalog id, which
 * stays tolerant (an unknown one folds nothing): a malformed or misplaced
 * reference is a 400 `validation_error`, one that is not the caller's (or no
 * longer exists) is a 404 `direction_not_found` naming the key. The request and
 * the job keep the id as sent — never the resolved text — so a re-run resolves
 * it again.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import {
  directionKeyForUserRef,
  parseUserDirectionRef,
  renderMoodboardClause,
  renderPaletteClause,
  type StyleReferenceInput,
  type UserDirectionRefKind,
} from "@nodaro/prompts/prompt-builder"
import { supabase } from "./supabase.js"
import { isMissingTableError } from "./postgrest-errors.js"
import { sendInternalError } from "./http-errors.js"
import { hasUserDirectionRefs, userDirectionRefKey, type ResolvedUserDirection } from "./user-direction-result.js"

// The pure half (the result's shape, the shape check, the moodboard warning)
// lives beside this file so the synchronous payload builder and the preset
// builder can read it without a database client.
export {
  hasUserDirectionRefs,
  moodboardWarnings,
  userDirectionRefKey,
  userDirectionRefValues,
  type ResolvedUserDirection,
  type RunWarning,
} from "./user-direction-result.js"

export interface UserDirectionRefusal {
  readonly status: 400 | 404
  readonly code: "validation_error" | "direction_not_found"
  /** The key at fault, e.g. `direction.colorLook`. */
  readonly field: string
  readonly message: string
}

export type UserDirectionOutcome =
  | { readonly ok: true; readonly value: ResolvedUserDirection | undefined }
  | { readonly ok: false; readonly refusal: UserDirectionRefusal }

interface FoundRef {
  readonly key: string
  readonly kind: UserDirectionRefKind
  readonly id: string
  readonly value: string
}

function valuesOf(v: unknown): unknown[] {
  if (typeof v === "string") return [v]
  return Array.isArray(v) ? v : []
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function refuse(status: 400 | 404, code: UserDirectionRefusal["code"], key: string, message: string): UserDirectionOutcome {
  return { ok: false, refusal: { status, code, field: `direction.${key}`, message } }
}

/**
 * The references a bag names, checked for shape: each on the key that takes
 * its kind, followed by a uuid, and the key's ONLY value (both keys pick one —
 * a second value would slice the reference away or be dropped in silence).
 */
function scan(direction: Record<string, unknown>): { refs: FoundRef[] } | { refusal: UserDirectionOutcome } {
  const refs: FoundRef[] = []
  for (const [key, raw] of Object.entries(direction)) {
    const values = valuesOf(raw)
    for (const value of values) {
      const ref = parseUserDirectionRef(value)
      if (ref === null) continue
      const home = directionKeyForUserRef(ref.kind)
      if (key !== home) {
        return { refusal: refuse(400, "validation_error", key, `direction.${key}: a ${ref.kind} goes on direction.${home} ("${ref.kind}:<id>")`) }
      }
      if (!ref.wellFormed) {
        return { refusal: refuse(400, "validation_error", key, `direction.${key}: "${ref.kind}:" must be followed by the ${ref.kind}'s id (a uuid)`) }
      }
      if (values.length > 1) {
        return { refusal: refuse(400, "validation_error", key, `direction.${key}: a ${ref.kind} must be the only value of direction.${key}`) }
      }
      refs.push({ key, kind: ref.kind, id: ref.id, value: value as string })
    }
  }
  return { refs }
}

interface PaletteHit { id: string; name: string; colors: string[] }
interface MoodboardHit { id: string; name: string; description: string | null; images: unknown }

/** One row of `table` among the owners, or null. A missing table is "none" —
 *  the table reaches the shared database when main deploys. */
async function ownedRow<T>(table: "color_palettes" | "moodboards", columns: string, id: string, owners: readonly string[]): Promise<T | null> {
  const { data, error } = await supabase.from(table).select(columns).eq("id", id).in("user_id", [...owners]).maybeSingle()
  if (isMissingTableError(error)) return null
  if (error) throw error
  return (data as T | null) ?? null
}

const HTTP_URL = /^https?:\/\//i

function styleReferencesOf(images: unknown): StyleReferenceInput[] {
  if (!Array.isArray(images)) return []
  const out: StyleReferenceInput[] = []
  for (const image of images) {
    if (!isRecord(image) || typeof image.url !== "string" || !HTTP_URL.test(image.url)) continue
    out.push(typeof image.caption === "string" && image.caption ? { url: image.url, caption: image.caption } : { url: image.url })
  }
  return out
}

/**
 * Resolve the user-owned references `direction` names, reading each row only
 * among `owners` — a list for every value (the route: the caller), or, per
 * value, the rows of whoever supplied it (a workflow run: a value saved in the
 * graph is the workflow owner's, anything the run supplied the runner's —
 * `node-user-direction.ts`). `value: undefined` when it names none — and then
 * nothing is read. A database error other than a missing table throws.
 */
export async function resolveUserDirection(
  direction: unknown,
  owners: readonly string[] | ((value: string) => readonly string[]),
): Promise<UserDirectionOutcome> {
  if (!isRecord(direction)) return { ok: true, value: undefined }
  const scanned = scan(direction)
  if ("refusal" in scanned) return scanned.refusal
  if (scanned.refs.length === 0) return { ok: true, value: undefined }

  const ownersOf = (value: string): string[] =>
    [...new Set((typeof owners === "function" ? owners(value) : owners).filter((o) => typeof o === "string" && o.length > 0))]
  const refs = new Map<string, string>()
  let styleReferences: StyleReferenceInput[] = []
  let moodboard: ResolvedUserDirection["moodboard"]

  for (const ref of scanned.refs) {
    const notFound = refuse(404, "direction_not_found", ref.key, `direction.${ref.key}: no ${ref.kind} ${ref.id} among yours`)
    const ownerIds = ownersOf(ref.value)
    if (ownerIds.length === 0) return notFound
    if (ref.kind === "palette") {
      const row = await ownedRow<PaletteHit>("color_palettes", "id, name, colors", ref.id, ownerIds)
      if (!row) return notFound
      const clause = renderPaletteClause(Array.isArray(row.colors) ? row.colors : [])
      if (clause) refs.set(ref.value, clause)
    } else {
      const row = await ownedRow<MoodboardHit>("moodboards", "id, name, description, images", ref.id, ownerIds)
      if (!row) return notFound
      const clause = renderMoodboardClause(row.description)
      if (clause) refs.set(ref.value, clause)
      styleReferences = styleReferencesOf(row.images)
      moodboard = { id: row.id, name: row.name }
    }
  }
  return { ok: true, value: { refs, styleReferences, ...(moodboard ? { moodboard } : {}) } }
}

/**
 * The 400 a route answers when a direction names the caller's palette or
 * moodboard but the route cannot use one (the video routes: their reference
 * machinery is another), or null. Refusing beats folding nothing — a
 * user-owned resource must not be ignored in silence.
 */
export function userDirectionNotSupported(
  direction: unknown,
): { error: { code: "validation_error"; message: string; field: string } } | null {
  const key = userDirectionRefKey(direction)
  if (key === undefined) return null
  return {
    error: {
      code: "validation_error",
      message: `direction.${key}: palette and moodboard directions work on generate-image only`,
      field: `direction.${key}`,
    },
  }
}

/* ------------------------------------------------------------- REST lane */

const stash = new WeakMap<FastifyRequest, ResolvedUserDirection>()

/** What `userDirectionPreHandler` resolved for this request, if anything. */
export function userDirectionOf(req: FastifyRequest): ResolvedUserDirection | undefined {
  return stash.get(req)
}

/**
 * The route lane: resolve the request body's `direction` before the credit
 * guard prices the run (a moodboard's images are references, and references
 * pick the model and its price), and keep the result for the handler — so the
 * price checked and the price reserved come from one resolution. Runs on the
 * RAW body, so it is defensive about shape; a body with no user-owned
 * reference passes straight through. A refusal ends the request here, before
 * anything is created or charged.
 */
export async function userDirectionPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const body = req.body
  if (!isRecord(body) || !hasUserDirectionRefs(body.direction)) return
  if (!req.userId) {
    return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
  }
  try {
    const outcome = await resolveUserDirection(body.direction, [req.userId])
    if (!outcome.ok) {
      const { status, code, field, message } = outcome.refusal
      return reply.status(status).send({ error: { code, message, field } })
    }
    if (outcome.value) stash.set(req, outcome.value)
  } catch (err) {
    return sendInternalError(reply, req, err, "Failed to read the palette or moodboard")
  }
}
