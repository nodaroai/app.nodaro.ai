import type { DbCharacter, DbObject, DbLocation } from "@/lib/api"

/**
 * Build the {@link saveLocation} payload used by `handleInject()` in
 * `editor-toolbar.tsx` when re-creating a bundled `DbLocation` under the
 * caller's account.
 *
 * Extracted into a pure helper so we can unit-test the round-trip of every
 * field the export envelope carries. The old inline call silently dropped
 * Location Studio Phase 1 fields (lighting, seasons, atmosphereMotions,
 * referencePhotos, canonicalDescription, styleLock) — this helper is the
 * regression net that locks the contract in place.
 *
 * Mirror of the equivalent server-side re-create in
 * `backend/src/lib/workflow-assets.ts::reCreateAssets()` for the "import as
 * new" path. Keeping the two in sync is enforced by the round-trip test in
 * `__tests__/editor-toolbar-import-export.test.ts`.
 */
export function buildSaveLocationPayloadFromExport(
  loc: DbLocation,
  projectId: string | undefined,
): Parameters<typeof import("@/lib/api").saveLocation>[0] {
  return {
    nodeId: loc.nodeId,
    projectId,
    name: loc.name,
    description: loc.description ?? undefined,
    category: loc.category ?? undefined,
    style: loc.style ?? undefined,
    sourceImageUrl: loc.sourceImageUrl ?? undefined,
    timeOfDay: loc.timeOfDay ?? [],
    weather: loc.weather ?? [],
    angles: loc.angles ?? [],
    // Location Studio Phase 1 (migration 124).
    lighting: loc.lighting ?? [],
    seasons: loc.seasons ?? [],
    atmosphereMotions: loc.atmosphereMotions ?? [],
    referencePhotos: loc.referencePhotos ?? [],
    canonicalDescription: loc.canonicalDescription ?? undefined,
    styleLock: loc.styleLock ?? undefined,
  }
}

/** Sibling helper for characters — pure mirror of the inline inject call. */
export function buildSaveCharacterPayloadFromExport(
  char: DbCharacter,
  projectId: string | undefined,
): Parameters<typeof import("@/lib/api").saveCharacter>[0] {
  return {
    nodeId: char.nodeId,
    projectId,
    name: char.name,
    description: char.description ?? undefined,
    gender: char.gender ?? undefined,
    style: char.style ?? undefined,
    baseOutfit: char.baseOutfit ?? undefined,
    sourceImageUrl: char.sourceImageUrl ?? undefined,
    expressions: char.expressions ?? [],
    poses: char.poses ?? [],
    lightingVariations: char.lightingVariations ?? [],
  }
}

/** Sibling helper for objects — pure mirror of the inline inject call. */
export function buildSaveObjectPayloadFromExport(
  obj: DbObject,
  projectId: string | undefined,
): Parameters<typeof import("@/lib/api").saveObject>[0] {
  return {
    nodeId: obj.nodeId,
    projectId,
    name: obj.name,
    description: obj.description ?? undefined,
    category: obj.category ?? undefined,
    style: obj.style ?? undefined,
    sourceImageUrl: obj.sourceImageUrl ?? undefined,
    angles: obj.angles ?? [],
    materials: obj.materials ?? [],
    variations: obj.variations ?? [],
  }
}
