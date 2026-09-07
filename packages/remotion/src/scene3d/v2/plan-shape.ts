/**
 * The v2 wire shape, re-exported from `@nodaro/shared`.
 *
 * The contract is the single source of truth — this module only NAMES the
 * pieces the renderer consumes, so a contract change surfaces as a type error
 * here rather than as silent drift in the scene builder. Nothing below
 * re-declares a field.
 *
 * Renderer-side notes on the two rules that decide what gets drawn:
 *
 *  - `Scene3DEntityV2.position/rotation/scale` are the entity's base transform
 *    for `group` and `primitive` visuals. For an `asset` visual the GLB node's
 *    own transform is authoritative and the manifest values are an
 *    informational frame-0 snapshot — applying both is the double-transform
 *    bug, so `scene-builder-v2.ts` applies exactly one of them.
 *  - `Scene3DAssetAnimation` maps a clip onto public frames; sampling is
 *    `time = (frame - startFrame) / fps`, never a wall-clock delta.
 */
export type {
  Scene3DPlanV2,
  Scene3DPlanV1,
  Scene3DPlan,
  Scene3DEntityV2,
  Scene3DEntityVisual,
  Scene3DEntityCapability,
  Scene3DEntityRole,
  Scene3DAssetRef,
  Scene3DAssetKind,
  Scene3DAssetRole,
  Scene3DAssetAnimation,
  Scene3DAnchor,
  Scene3DMaterialBinding,
  Scene3DShot,
  Scene3DOverride,
  Scene3DOverrideSpace,
  Scene3DClayLighting,
  Scene3DProvenance,
  Scene3DCameraTrackV1,
  Scene3DCameraSample,
  Scene3DSupportedSchemaVersion,
} from "@nodaro/shared"

export {
  isScene3DPlanV2,
  isScene3DPlanV1,
  isScene3DPlan,
  isScene3DSchemaVersionSupported,
  scene3DPlanSchemaVersion,
  SCENE3D_SUPPORTED_SCHEMA_VERSIONS,
  SCENE3D_SCHEMA_VERSION_V2,
  SCENE3D_GLB_EXTRAS_ENTITY_ID,
  SCENE3D_GLB_EXTRAS_SUBPART_ID,
  SCENE3D_GLB_EXTRAS_MATERIAL_ROLE,
  SCENE3D_GLB_EXTRAS_ALLOWLIST,
  SCENE3D_RENDERER_ASSET_KINDS,
  SCENE3D_PRIMITIVE_MATERIAL_ROLE,
} from "@nodaro/shared"
