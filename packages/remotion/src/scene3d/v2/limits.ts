/**
 * Limits the renderer enforces.
 *
 * The PUBLIC admission ceilings (entities, triangles, bytes, shots, fps,
 * dimensions) come from `@nodaro/shared` — they are server-configured and
 * returned in capabilities, and duplicating a number here is how the renderer
 * and the API end up disagreeing about what is admissible.
 *
 * What IS local is the parser's own allocation budget: how big a GLB's JSON
 * chunk may be before `JSON.parse` runs, how many accessors a single file may
 * declare, which glTF extensions can be honoured without downloading decoder
 * code. Those are properties of THIS renderer's implementation, not of the
 * wire format, so they live with the renderer.
 */
export { SCENE3D_V2_LIMITS } from "@nodaro/shared"

export const SCENE3D_RENDERER_GLB_LIMITS = {
  /** One GLB. The aggregate byte budget is the shared `maxRendererAssetBytes`. */
  maxGlbBytes: 64 * 1024 * 1024,
  /** JSON chunk of a GLB, capped BEFORE `JSON.parse` allocates anything. */
  maxJsonChunkBytes: 8 * 1024 * 1024,
  /** Nodes in one GLB's `nodes` array — bounds traversal cost. */
  maxNodes: 8192,
  /** Accessors / bufferViews in one GLB — bounds pre-parse cost. */
  maxAccessors: 8192,
  /** Animation channels bound across all assets. */
  maxAnimationTracks: 4096,
} as const

/** glTF extensions the renderer can honour without downloading decoder code. */
export const SCENE3D_V2_ALLOWED_GLTF_EXTENSIONS: readonly string[] = [
  "KHR_materials_unlit",
  "KHR_materials_emissive_strength",
  "KHR_texture_transform",
]
