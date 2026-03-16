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
