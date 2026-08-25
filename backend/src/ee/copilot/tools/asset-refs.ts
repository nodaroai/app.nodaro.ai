/**
 * Turn the ids the model was given into the media a node actually needs.
 *
 * A mention hands the model an ID, never an address — `edit_workflow` refuses
 * to let it write a URL, and that refusal is the whole egress boundary. So the
 * model says WHICH file, and this says where it is.
 *
 * A deliberate SIBLING of `lib/mcp/asset-resolver.ts` rather than a wrapper.
 * That one distinguishes "belongs to someone else" from "does not exist", which
 * is an existence oracle: fine for a tool the user drives, wrong for one a
 * model drives with ids it can guess. Here the ownership predicate is part of
 * the QUERY, so a foreign id and a nonexistent id come back the same way — zero
 * rows — and there is nothing to probe.
 *
 * Batched: two queries for any number of ids, never one per id.
 */
import { supabase } from "../../../lib/supabase.js"
import { isUuid } from "../../../lib/mcp/tools/_id-guard.js"

export type AssetKind = "image" | "video" | "audio"

export interface ResolvedAsset {
  id: string
  kind: AssetKind
  /** Where the file is. The only value that reaches a node. */
  url: string
  filename: string
  mimeType: string
  fileSize: number
  thumbnailUrl: string
}

/** At most this many per call — a graph edit wires files, it does not import a library. */
export const MAX_ASSET_REFS = 20

/** `jobs.job_type` → what the output IS. Mirrors `asset-resolver.ts`'s sets. */
const IMAGE_JOB_URL = "imageUrl"
const VIDEO_JOB_URL = "videoUrl"
const AUDIO_JOB_URL = "audioUrl"

/**
 * Which media a completed job produced, read from what it actually output
 * rather than from its type.
 *
 * Job types are a long and growing list, and a new generation verb would be
 * unreachable until someone remembered to add it. The output keys are three,
 * fixed by the wire contract, and they are the same three keys the node needs.
 */
function kindFromOutput(output: Record<string, unknown>): { kind: AssetKind; url: string } | null {
  for (const [key, kind] of [
    [IMAGE_JOB_URL, "image"],
    [VIDEO_JOB_URL, "video"],
    [AUDIO_JOB_URL, "audio"],
  ] as const) {
    const url = output[key]
    if (typeof url === "string" && url.length > 0) return { kind, url }
  }
  return null
}

function basename(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url
  return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1) || "file"
}

/**
 * Resolve every id that is the caller's own, and say nothing about the rest.
 *
 * Misses are simply absent from the map — the caller turns that into ONE
 * message. Never report WHY an id missed: "not yours" and "no such thing" have
 * to be indistinguishable.
 *
 * A malformed id never reaches a query. Entity and asset ids are `uuid`
 * columns, so one value that cannot be a uuid makes Postgres reject the whole
 * batch — which would take every well-formed id in the same call down with it.
 */
export async function resolveCopilotAssetRefs(
  ids: readonly string[],
  userId: string,
): Promise<Map<string, ResolvedAsset>> {
  const resolved = new Map<string, ResolvedAsset>()
  // The uploads query builds its predicate by INTERPOLATION, because PostgREST
  // has no parameter form for `.or()`. Today `userId` is a uuid off a verified
  // JWT and cannot carry a comma or a paren — so this asserts the thing the
  // query is already relying on, rather than trusting a caller two layers away
  // to keep relying on it.
  if (!userId || !isUuid(userId)) return resolved
  const wanted = [...new Set(ids.filter((id) => isUuid(id)))]
  if (wanted.length === 0) return resolved

  // 1. Generations. Scoped in the query — a job that is not the caller's is
  //    simply not returned, the same as one that does not exist.
  const jobs = await supabase
    .from("jobs")
    .select("id, output_data")
    .in("id", wanted)
    .eq("user_id", userId)
  if (jobs.error) throw new Error(`Failed to resolve assets: ${jobs.error.message}`)

  for (const row of (jobs.data ?? []) as Array<{ id: string; output_data: Record<string, unknown> | null }>) {
    const produced = kindFromOutput(row.output_data ?? {})
    // A job with no output yet is a miss, not an error: it is still running,
    // and the caller's one wording covers it.
    if (!produced) continue
    resolved.set(row.id, {
      id: row.id,
      kind: produced.kind,
      url: produced.url,
      filename: basename(produced.url),
      mimeType: "",
      fileSize: 0,
      thumbnailUrl: (row.output_data?.thumbnailUrl as string | undefined) ?? "",
    })
  }

  // 2. Uploads, for whatever the first query did not answer.
  const remaining = wanted.filter((id) => !resolved.has(id))
  if (remaining.length === 0) return resolved

  // `is_library_item` is admin-only on every write path, which is what makes it
  // safe to widen to here. NEVER add `is_shared`: that one is user-settable, so
  // any user could make their asset readable by every model in the system.
  const assets = await supabase
    .from("assets")
    .select("id, type, r2_url, filename, mime_type, size_bytes, metadata")
    .in("id", remaining)
    .or(`user_id.eq.${userId},is_library_item.is.true`)
  if (assets.error) throw new Error(`Failed to resolve assets: ${assets.error.message}`)

  for (const row of (assets.data ?? []) as Array<{
    id: string
    type: string | null
    r2_url: string | null
    filename: string | null
    mime_type: string | null
    size_bytes: number | null
    metadata: Record<string, unknown> | null
  }>) {
    const kind = row.type
    if (kind !== "image" && kind !== "video" && kind !== "audio") continue
    if (!row.r2_url) continue
    resolved.set(row.id, {
      id: row.id,
      kind,
      url: row.r2_url,
      filename: row.filename ?? basename(row.r2_url),
      mimeType: row.mime_type ?? "",
      fileSize: row.size_bytes ?? 0,
      thumbnailUrl: (row.metadata?.thumbnailUrl as string | undefined) ?? "",
    })
  }

  return resolved
}
