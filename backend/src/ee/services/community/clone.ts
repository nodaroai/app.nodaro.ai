import { randomUUID } from "node:crypto"
import { supabase } from "../../../lib/supabase.js"
import { reserveStorageIfWithinLimit, refundStorage } from "../../../utils/file-validation.js"
import { ensureDefaultProject } from "../../../lib/default-project.js"
import { deriveAvailableName } from "../../../lib/entity-naming.js"
import { copyR2ObjectToPrefix, batchDeleteFromR2, r2KeyFromOurUrl } from "../../../lib/storage.js"
import { buildCloneRow, COMMUNITY_ENTITY_ADAPTERS, type EntityType } from "../../lib/community-entity-adapters.js"

/** Internal marker so the outer catch never double-rolls-back an error whose
 *  resources were already released inline (reservation reject + insert fail). */
interface RolledBackError extends Error {
  rolledBack?: true
  code?: string
}

export async function cloneListing(input: {
  listingId: string
  entityType: EntityType
  userId: string
}): Promise<{ entityType: EntityType; id: string }> {
  const { listingId, entityType, userId } = input
  const adapter = COMMUNITY_ENTITY_ADAPTERS[entityType]

  // Reject clones of taken-down/inactive listings (a stale listingId could
  // otherwise be cloned during the reaper grace window before blobs are purged).
  const { data: listing } = await supabase
    .from("community_listings")
    .select("is_active")
    .eq("id", listingId)
    .single()
  if (!listing?.is_active) {
    const e = new Error("listing_unavailable") as Error & { code?: string }
    e.code = "listing_unavailable"
    throw e
  }

  const { data: snapRow } = await supabase
    .from("community_listing_snapshots")
    .select("snapshot")
    .eq("listing_id", listingId)
    .single()
  const snapshot = (snapRow?.snapshot ?? {}) as Record<string, unknown>

  const proj = await ensureDefaultProject(userId)
  if ("error" in proj) throw new Error(proj.error)

  const destPrefix = `user-clones/${userId}/${randomUUID()}/`
  const copiedAssets: Record<string, unknown> = {}
  const copiedUrls: string[] = []
  let bytes = 0
  const copyUrl = async (url: string): Promise<string> => {
    const { url: u, bytes: b } = await copyR2ObjectToPrefix(url, destPrefix)
    bytes += b
    copiedUrls.push(u)
    return u
  }

  try {
    for (const f of adapter.assetFields) {
      const v = snapshot[f]
      if (v == null) continue
      if (typeof v === "string") {
        copiedAssets[f] = await copyUrl(v)
      } else if (Array.isArray(v)) {
        copiedAssets[f] = await Promise.all(
          (v as Array<{ url?: string }>).map(async (it) =>
            it?.url ? { ...it, url: await copyUrl(it.url) } : it,
          ),
        )
      } else if (typeof v === "object") {
        const obj: Record<string, unknown> = {}
        for (const [k, vv] of Object.entries(v as Record<string, unknown>)) {
          obj[k] = typeof vv === "string" ? await copyUrl(vv) : vv
        }
        copiedAssets[f] = obj
      }
    }

    const reserved = await reserveStorageIfWithinLimit(userId, bytes)
    if (!reserved) {
      // No reservation was made → only the copied blobs need cleanup.
      await rollback(copiedUrls, userId, 0)
      const e = new Error("storage_limit_exceeded") as RolledBackError
      e.code = "storage_limit_exceeded"
      e.rolledBack = true
      throw e
    }

    const name = await deriveAvailableName(adapter.table, userId, String(snapshot.name ?? "Untitled"))
    const cloneRow = buildCloneRow(entityType, snapshot, {
      userId,
      projectId: proj.projectId,
      name,
      copiedAssets,
    })
    const { data: inserted, error } = await supabase
      .from(adapter.table)
      .insert(cloneRow)
      .select("id")
      .single()
    if (error || !inserted) {
      // Reservation succeeded but the row never landed → refund + delete blobs.
      await rollback(copiedUrls, userId, bytes)
      const e = new Error(`clone insert failed: ${error?.message ?? "no row"}`) as RolledBackError
      e.rolledBack = true
      throw e
    }

    await supabase.rpc("record_clone", {
      p_listing_id: listingId,
      p_user_id: userId,
      p_entity_type: entityType,
      p_new_entity_id: inserted.id,
    })
    return { entityType, id: inserted.id as string }
  } catch (err) {
    // Only roll back here for failures that did NOT already release resources
    // inline (e.g. a copy error mid-loop, or the record_clone RPC throwing).
    if (!(err as RolledBackError).rolledBack && copiedUrls.length) {
      await rollback(copiedUrls, userId, bytes).catch(() => {})
    }
    throw err
  }
}

async function rollback(urls: string[], userId: string, reservedBytes: number): Promise<void> {
  const keys = urls.map((u) => r2KeyFromOurUrl(u)).filter((k): k is string => !!k)
  if (keys.length) await batchDeleteFromR2(keys)
  if (reservedBytes > 0) await refundStorage(userId, reservedBytes)
}
