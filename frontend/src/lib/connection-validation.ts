import { isValidGenerateImageConnection } from "./generate-image-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "./parameter-picker-types"

const MEDIA_ONLY_HANDLES: ReadonlySet<string> = new Set([
  "image",
  "video",
  "audio",
  "startFrame",
  "endFrame",
  "video1",
  "video2",
  "video3",
  "video4",
  "audio1",
  "audio2",
  "audio3",
  "audio4",
  "audio5",
  "ref-audio",
])

export interface ConnectionShape {
  readonly source?: string | null
  readonly target?: string | null
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

/**
 * Pure validity check for a workflow connection. Mirrors the rules enforced
 * by `<ReactFlow isValidConnection>` in `workflow-canvas.tsx` so any code path
 * that creates edges outside of drag-to-connect (e.g., HandlePopover's
 * Connect button) can reuse the SAME rules without duplicating logic.
 *
 * Pass `getNodeType(id)` so the helper stays decoupled from React Flow's
 * `getNode` API — call sites either reach into the store or the React Flow
 * instance and project to just the type string.
 */
export function isValidWorkflowConnection(
  connection: ConnectionShape,
  getNodeType: (id: string) => string | undefined,
): boolean {
  // Helper to resolve a connection endpoint to its node type. Uses the
  // ternary form (not `?? ""`) so we don't do a Map lookup with an empty-
  // string key — both spellings yield the same answer today, but the
  // ternary makes the intent explicit and matches the pattern used below.
  const typeOf = (id: string | null | undefined): string | undefined =>
    id ? getNodeType(id) : undefined

  // Composition output may ONLY target render-video. (Same rule as in
  // workflow-canvas.tsx::isValidConnection.)
  if (connection.sourceHandle === "composition") {
    return typeOf(connection.target) === "render-video"
  }

  // JSON output cannot feed media-only inputs.
  if (connection.sourceHandle === "json") {
    const th = connection.targetHandle ?? ""
    if (MEDIA_ONLY_HANDLES.has(th)) return false
  }

  // Generate Image v2.1 — enforce typed-handle compatibility.
  const targetType = typeOf(connection.target)
  if (targetType === "generate-image" && connection.targetHandle) {
    const sourceType = typeOf(connection.source)
    if (sourceType) {
      return isValidGenerateImageConnection(
        connection.targetHandle,
        sourceType,
        (t) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(t),
      )
    }
  }

  return true
}
