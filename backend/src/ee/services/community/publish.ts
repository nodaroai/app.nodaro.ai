import { randomUUID } from "node:crypto"
import { supabase } from "../../../lib/supabase.js"
import { generateSlug, getCreatorDisplayName } from "../../../lib/marketplace-helpers.js"
import { buildSnapshot, type EntityType } from "../../lib/community-entity-adapters.js"
import { copyEntityAssetsToPrefix, purgeCommunityListingBlobs } from "./asset-lifecycle.js"
import { accountStorage } from "../../../utils/file-validation.js"

const PREVIEW_BUDGET: Record<EntityType, number> = { character: 8, location: 4, object: 4 }

export interface PublishInput {
  entityType: EntityType
  sourceRow: Record<string, unknown> & { id: string }
  creatorId: string
  title: string
  description: string | null
  category: string | null
  style: string | null
  tags: string[]
  likenessAttestation: boolean
}

export async function publishListing(input: PublishInput): Promise<{ slug: string; id: string }> {
  const { entityType, sourceRow, creatorId } = input

  const { data: existing } = await supabase
    .from("community_listings")
    .select("id")
    .eq("source_id", sourceRow.id)
    .maybeSingle()
  const listingId = (existing?.id as string | undefined) ?? randomUUID()
  if (existing?.id) await purgeCommunityListingBlobs(existing.id as string)

  const budget = PREVIEW_BUDGET[entityType]
  const { copiedAssets, bytes, previewImages } = await copyEntityAssetsToPrefix(
    entityType, sourceRow, listingId, budget,
  )
  const snapshot = buildSnapshot(entityType, sourceRow, copiedAssets)
  const displayName = await getCreatorDisplayName(creatorId)

  const { data, error } = await supabase.rpc("publish_community_listing", {
    p_id: listingId,
    p_source_id: sourceRow.id,
    p_entity_type: entityType,
    p_creator_id: creatorId,
    p_creator_display_name: displayName,
    p_slug: generateSlug(input.title),
    p_title: input.title,
    p_description: input.description,
    p_category: input.category,
    p_style: input.style,
    p_tags: input.tags,
    p_preview_media_url: previewImages[0] ?? null,
    p_preview_images: previewImages.map((url) => ({ url })),
    p_likeness_attestation_at: entityType === "character" && input.likenessAttestation ? new Date().toISOString() : null,
    p_published_bytes: bytes,
    p_snapshot: snapshot,
  })
  if (error) throw new Error(`publish failed: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; slug: string }>
  if (rows.length === 0) throw new Error("publish failed: not owner or no row returned")
  // Account the community copy against the publisher (design §11: publisher owns
  // the copy). purgeCommunityListingBlobs refunds these bytes on
  // unpublish/takedown/re-publish, keeping storage accounting symmetric. On
  // re-publish the pre-publish purge above already refunded the old bytes.
  await accountStorage(creatorId, bytes)
  return { id: rows[0]!.id, slug: rows[0]!.slug }
}
