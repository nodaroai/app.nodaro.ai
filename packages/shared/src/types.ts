/**
 * Generic node/edge interfaces for structural subtyping.
 * Both frontend WorkflowNode and backend SimpleNode satisfy these.
 */

export interface GenericNode {
  id: string
  type: string
  data: Record<string, unknown>
  hidden?: boolean
}

export interface GenericEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface CharacterDef {
  id: string
  name: string
  type: "reference" | "description"
  category?: string
  referenceImageUrl?: string
  description?: string
}

// ---------------------------------------------------------------------------
// Reference image metadata.
//
// An "identity" = (imageIndex, label) — what role this image plays at a given
// mention. The same image can appear under multiple identities (e.g. image 1
// used both as `:dragon` and as `:background`). Tokens in the prompt are
// `{image:N:label}`, with `{image:N}` as a backward-compat positional ref.
// ---------------------------------------------------------------------------

export type IdentityFidelity = "strict" | "balanced" | "loose" | "custom"

export type ReferenceSource =
  | "manual"
  | "wired-image"
  | "wired-character"
  | "wired-face"
  | "wired-object"
  | "wired-location"

/** Per-identity user override stored on the consumer node. */
export interface IdentityMeta {
  /** 1-based position of the source image. */
  imageIndex: number
  /** Role label this entry covers (e.g. "object", "background", "person"). */
  label: string
  fidelity?: IdentityFidelity
  /** Free-text directive used when fidelity === "custom" (replaces the preset). */
  customText?: string
}

/** Computed view of a single connected reference, ready for the prompt builder. */
export interface ConnectedReference {
  id: string
  defaultName: string
  source: ReferenceSource
  /** Optional rich text from upstream char/face/object/location node. */
  description?: string
  url: string
}

/** Default label per source — used by `@` autocomplete and inventory fallback. */
export const DEFAULT_LABEL_BY_SOURCE: Record<ReferenceSource, string> = {
  "manual": "object",
  "wired-image": "object",
  "wired-character": "person",
  "wired-face": "face",
  "wired-object": "object",
  "wired-location": "background",
}

// ---------------------------------------------------------------------------
// Scene node data — minimal interface for buildScenePrompt.
// Frontend SceneNodeDataType satisfies this via structural subtyping.
// Backend casts Record<string, unknown> node data to this.
// ---------------------------------------------------------------------------

export interface SceneCharacterEntry {
  readonly assetId: string
  readonly mood: string
  readonly action: string
  readonly positionInFrame?: "left" | "center" | "right" | "foreground" | "background"
}

export interface SceneLocationEntry {
  readonly assetId: string
  readonly name?: string
  readonly isPrimary?: boolean
  readonly timeOfDay?: string
  readonly weather?: string
  readonly lighting?: string
}

export interface SceneObjectEntry {
  readonly assetId: string
  readonly description?: string
}

export interface SceneDialogueEntry {
  readonly characterName: string
  readonly text: string
  readonly emotion?: string
}

export interface SceneData {
  readonly shotType: string
  readonly cameraAngle: string
  readonly aspectRatio: string
  readonly characters: readonly SceneCharacterEntry[]
  readonly locations?: readonly SceneLocationEntry[]
  readonly objects: readonly SceneObjectEntry[]
  readonly mood: readonly string[]
  readonly visualStyle: string
  readonly depthOfField: string
  readonly lensType: string
  readonly cameraMovement: string
  readonly colorPalette: readonly string[]
  readonly summary: string
  readonly dialogue?: readonly SceneDialogueEntry[]
  readonly directorNotes?: string
  readonly timeOfDay: string
  readonly weather: string
  readonly lighting: string
}
