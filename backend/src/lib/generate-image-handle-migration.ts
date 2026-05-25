interface WorkflowNodeLike {
  readonly id: string
  readonly type?: string
}
interface WorkflowEdgeLike {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

const TEXT_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "text-prompt",
  "ai-writer",
  "llm-chat",
  "generate-script",
  "combine-text",
  "image-to-text",
  "split-text",
])
const IMAGE_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "upload-image",
  "generate-image",
  "edit-image",
  "image-to-image",
  "modify-image",
  "upscale-image",
  "remove-background",
])
const IDENTITY_TYPES: ReadonlySet<string> = new Set(["character", "location", "object", "face"])

// v2.1: pickers split between `look` (Look + Camera registry families) and
// `elements` (Subject / Object family + instrumentation). Keep in sync with
// frontend `generate-image-handles.ts::LOOK_PICKER_TYPES / ELEMENTS_PICKER_TYPES`.
const LOOK_PICKER_TYPES: ReadonlySet<string> = new Set([
  "setting", "atmosphere", "style", "color-look", "mood", "photographer",
  "aesthetic", "era", "photo-genre", "backdrop", "render-quality",
  "composition-effects", "action-fx", "loop-subject", "post-process-effects",
  "tone", "camera-motion", "lens", "camera-format", "framing", "lighting",
  "exposure-settings", "temporal", "transition", "character-fx",
])
const ELEMENTS_PICKER_TYPES: ReadonlySet<string> = new Set([
  "person", "pose", "animal", "vehicle", "weapon", "furniture", "material",
  "held-prop", "styling", "instrumentation",
])

function classifyForGenerateImage(sourceType: string): "prompt" | "references" | "assets" | "look" | "elements" {
  if (TEXT_PRODUCER_TYPES.has(sourceType)) return "prompt"
  if (IMAGE_PRODUCER_TYPES.has(sourceType)) return "references"
  if (IDENTITY_TYPES.has(sourceType)) return "assets"
  if (LOOK_PICKER_TYPES.has(sourceType)) return "look"
  if (ELEMENTS_PICKER_TYPES.has(sourceType)) return "elements"
  return "prompt"
}

/**
 * Defensive mirror of the frontend migration. Runs on workflow create/save,
 * MCP import/update, and orchestrator pre-execution. Idempotent.
 */
export function migrateGenerateImageHandles<E extends WorkflowEdgeLike>(
  nodes: ReadonlyArray<WorkflowNodeLike>,
  edges: ReadonlyArray<E>,
): E[] {
  const genIds = new Set(nodes.filter((n) => n.type === "generate-image").map((n) => n.id))
  if (genIds.size === 0) return [...edges]
  const typeById = new Map<string, string>(nodes.map((n) => [n.id, n.type ?? ""]))

  return edges.map((e) => {
    if (!genIds.has(e.target)) return e
    // v2.1: classify legacy `cinematography` / `style` edges into look/elements
    // by picker family.
    if (e.targetHandle === "cinematography" || e.targetHandle === "style") {
      const sourceType = typeById.get(e.source) ?? ""
      const classified = classifyForGenerateImage(sourceType)
      const newHandle = classified === "look" || classified === "elements" ? classified : "look"
      return { ...e, targetHandle: newHandle }
    }
    // v2.1: rename `subjects` → `assets` for identity refs.
    if (e.targetHandle === "subjects") {
      return { ...e, targetHandle: "assets" }
    }
    if (e.targetHandle === "in" || e.targetHandle == null) {
      const sourceType = typeById.get(e.source) ?? ""
      return { ...e, targetHandle: classifyForGenerateImage(sourceType) }
    }
    return e
  })
}
