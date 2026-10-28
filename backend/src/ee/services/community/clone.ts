import { randomUUID } from "node:crypto"
import { supabase } from "../../../lib/supabase.js"
import { reserveStorageIfWithinLimit } from "../../../utils/file-validation.js"
import { ensureDefaultProject } from "../../../lib/default-project.js"
import { deriveAvailableName } from "../../../lib/entity-naming.js"
import { buildCloneRow, COMMUNITY_ENTITY_ADAPTERS, type EntityType } from "../../lib/community-entity-adapters.js"
import { copyEntityAssets, rollbackCopiedAssets } from "./copy-entity-assets.js"

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
  if ("personalSpaceDisabled" in proj) {
    // A clone lands in the caller's personal space by definition, so an
    // organization that has closed that space refuses the clone itself.
    //
    // `code`, not a message prefix. The first version of this carried the
    // refusal in the message text and asserted in a comment that the route
    // matched on it — the route matches on `code`, so the refusal arrived as
    // a 500 and the user was told the system had broken. Every other refusal
    // in this file already used `code`; inventing a second dialect for one
    // of them was the whole mistake.
    const e = new Error("personal_space_disabled") as Error & { code?: string }
    e.code = "personal_space_disabled"
    throw e
  }

  const destPrefix = `user-clones/${userId}/${randomUUID()}/`
  // Filled once the copy is in; a throw inside `copyEntityAssets` has already
  // deleted its partial copies, so the catch below has nothing to undo then.
  let copiedUrls: string[] = []
  let bytes = 0

  try {
    const copied = await copyEntityAssets(entityType, snapshot, destPrefix)
    copiedUrls = copied.copiedUrls
    bytes = copied.bytes
    const copiedAssets = copied.copiedAssets

    const reserved = await reserveStorageIfWithinLimit(userId, bytes)
    if (!reserved) {
      // No reservation was made → only the copied blobs need cleanup.
      await rollbackCopiedAssets(copiedUrls, userId, 0)
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
      await rollbackCopiedAssets(copiedUrls, userId, bytes)
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
      await rollbackCopiedAssets(copiedUrls, userId, bytes).catch(() => {})
    }
    throw err
  }
}
