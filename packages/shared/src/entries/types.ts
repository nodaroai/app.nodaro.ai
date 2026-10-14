/**
 * `@nodaro/shared/types` — Graph and reference base types, presentation item types, and other type-only wire shapes.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export type {
  GenericNode,
  GenericEdge,
  CharacterDef,
  ConnectedReference,
  DescribedReference,
  IdentityFidelity,
  IdentityMeta,
  ReferenceSource,
  SceneData,
} from "../types.js"
export { DEFAULT_LABEL_BY_SOURCE } from "../types.js"
export type { ExposableField, ExposableOutput, PresentationItem } from "../presentation-types.js"
// --- Shot-sequence visual elements (text/shape/image; shared with backend Zod validation) ---
export type { ShotElement, ShotTextElement, ShotShapeElement, ShotImageElement } from "../shot-element.js"
export * from "../hint-graph-types.js"
// --- Tag-free /v1/catalogs projection wire shape (the ONLY catalog type in shared) ---
export * from "../catalog-projection.js"
export type { CharacterMotionMetadata } from "../character-motion-metadata.js"
