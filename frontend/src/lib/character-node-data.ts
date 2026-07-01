import type { CharacterNodeData } from "@/types/nodes"
import { getCharacter } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { CHARACTER_VARIANT_ASSET_BUCKETS } from "@nodaro/shared"

type CharacterDetail = Awaited<ReturnType<typeof getCharacter>>

/** Asset buckets the hydrator MUST carry as `{name,url}[]`. Bound to the SAME
 *  single source of truth the @-mention / connected-reference expansion uses, so
 *  every @-able bucket is guaranteed hydrated (otherwise the picker / @ list sees
 *  empty data). The drift-guard test asserts the hydrator writes each. */
export const HYDRATED_ASSET_BUCKETS = CHARACTER_VARIANT_ASSET_BUCKETS

/** Merge a full character DETAIL response into existing node data, carrying every
 *  asset bucket. Used by all library→canvas load sites + the studio so there is one
 *  mapping (no per-call-site drift). Mirrors the proven use-character-studio mapping. */
export function mergeCharacterDetailIntoNodeData(
  prev: CharacterNodeData,
  fresh: CharacterDetail,
): CharacterNodeData {
  return {
    ...prev,
    characterName: fresh.name || prev.characterName,
    description: fresh.description ?? prev.description,
    gender: (fresh.gender as CharacterNodeData["gender"]) ?? prev.gender,
    style: (fresh.style as CharacterNodeData["style"]) ?? prev.style,
    baseOutfit: fresh.baseOutfit ?? prev.baseOutfit,
    sourceImageUrl: fresh.sourceImageUrl ?? prev.sourceImageUrl,
    expressions: fresh.expressions ?? prev.expressions,
    poses: fresh.poses ?? prev.poses,
    lightingVariations: fresh.lightingVariations ?? prev.lightingVariations,
    angles: fresh.angles ?? prev.angles,
    bodyAngles: fresh.bodyAngles ?? prev.bodyAngles,
    motions: fresh.motions ?? prev.motions,
    // Reference-sheet buckets — hydrate so the Sheet tab's "Existing sheets"
    // grid + sidebar badges populate, and so detail/wardrobe panels are reused
    // by the planner instead of regenerated.
    sheets: fresh.sheets ?? prev.sheets ?? [],
    detailCloseups: (fresh.detailCloseups as CharacterNodeData["detailCloseups"]) ?? prev.detailCloseups,
    outfitVariations: (fresh.outfitVariations as CharacterNodeData["outfitVariations"]) ?? prev.outfitVariations,
    // Named composite boards (Board tab) — carried so studio-created boards show.
    boards: (fresh.boards as CharacterNodeData["boards"]) ?? prev.boards,
    // Selection map — also the legacy home of pre-column boards (studioBoard*).
    selectedAssetByVariant: (fresh.selectedAssetByVariant as CharacterNodeData["selectedAssetByVariant"]) ?? prev.selectedAssetByVariant,
    // Uploaded reference videos per emotion/variant (Record<variant, urls[]>) —
    // NOT a {name,url}[] bucket, so it is intentionally absent from
    // HYDRATED_ASSET_BUCKETS (which the drift-guard maps to {name,url}[]).
    referenceVideosByVariant: (fresh.referenceVideosByVariant as CharacterNodeData["referenceVideosByVariant"]) ?? prev.referenceVideosByVariant,
    voice: (fresh.voice as CharacterNodeData["voice"]) ?? prev.voice,
    personality: fresh.personality ?? prev.personality,
    person: (fresh.person as CharacterNodeData["person"]) ?? prev.person,
    wardrobe: (fresh.wardrobe as CharacterNodeData["wardrobe"]) ?? prev.wardrobe,
    referencePhotos: fresh.referencePhotos ?? prev.referencePhotos,
    seedPrompt: fresh.seedPrompt ?? prev.seedPrompt,
    canonicalDescription: fresh.canonicalDescription ?? prev.canonicalDescription,
    identityLock: fresh.identityLock ?? prev.identityLock,
    realLifeRefsByVariant: fresh.realLifeRefsByVariant ?? prev.realLifeRefsByVariant,
  }
}

/** Fetch the FULL character DETAIL for `characterId` and merge it into the node
 *  `nodeId` (carrying angles, bodyAngles, motions, sheets, voice, … that the
 *  lightweight library list item omits). Used by every library→canvas load site
 *  so there is ONE hydrate path (no per-call-site drift).
 *
 *  Non-fatal on failure — the optimistic light fields stay. The guard re-reads
 *  the node fresh and requires it to (a) still exist, (b) still be a character,
 *  and (c) still bind the SAME `characterDbId` — so a late `getCharacter`
 *  response can never clobber a node whose id was re-issued to a DIFFERENT
 *  character by a `clearWorkflow()`/`loadWorkflow()` between the optimistic
 *  update and this fetch resolving. */
export function hydrateCharacterNodeFromDetail(nodeId: string, characterId: string): void {
  void getCharacter(characterId)
    .then((fresh) => {
      const cur = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
      if (cur?.type === "character" && (cur.data as CharacterNodeData).characterDbId === characterId) {
        const merged = mergeCharacterDetailIntoNodeData(cur.data as CharacterNodeData, fresh)
        // Skip the store write — and the autosave / updated_at churn it triggers —
        // when the live detail already matches the node. This matters now that
        // hydration runs on every workflow load (not just on placement): an
        // unchanged refresh must not mark the workflow dirty or trip the
        // "changed in another tab" latch.
        if (JSON.stringify(merged) !== JSON.stringify(cur.data)) {
          useWorkflowStore.getState().updateNodeData(nodeId, merged)
        }
      }
    })
    .catch(() => {})
}
