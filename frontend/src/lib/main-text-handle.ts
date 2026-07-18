import { PARAMETER_NODE_TYPES, HINT_EXEMPT_PARAMETER_TYPES } from "@nodaro/shared"

/**
 * Main text input handle per consumer node type.
 *
 * When the user wires an upstream text source into one of these handles, the
 * workflow store's `onConnect` auto-inserts `{SourceLabel}` into the mapped
 * data field — but only if that field is empty at connect time. This gives
 * users a one-click starting point for the inline `{Label}` injection
 * pattern, without silently overriding anything they've already typed.
 *
 * Handle id and data field diverge because UI nodes use a canonical `"in"`
 * handle even when the underlying data field is `userInput`, `directText`,
 * etc. Only nodes that actually accept freeform text on a specific handle
 * appear here; edit-image/modify-image don't (their prompt is strictly
 * manual) and combine-text/text-prompt are excluded because their handle
 * is a multi-input combiner rather than a single prompt slot.
 */
export interface MainTextHandle {
  readonly handle: string
  readonly field: string
}

/**
 * Per node type, the set of text-accepting target handles that participate
 * in `{Label}` auto-fill. A node can expose multiple (e.g. llm-chat has a
 * prompt + system-prompt handle feeding two different data fields).
 */
export const MAIN_TEXT_HANDLE: Readonly<Record<string, ReadonlyArray<MainTextHandle>>> = {
  // Handle ids MUST be the node's real rendered handle ids — onConnect
  // matches `m.handle === connection.targetHandle` exactly, so a stale id
  // means the auto-fill silently never fires for that node. An earlier "in"
  // era left 9 entries dead. Guarded by main-text-handle.test.ts against
  // the typed target-handle registry.
  "generate-image": [{ handle: "prompt", field: "prompt" }],
  "text-to-video": [{ handle: "prompt", field: "prompt" }],
  "generate-video": [{ handle: "prompt", field: "prompt" }],
  "generate-video-pro": [{ handle: "prompt", field: "prompt" }],
  // Span-replace sibling of generate-video-pro — same rendered handle id.
  "edit-video-pro": [{ handle: "prompt", field: "prompt" }],
  "text-to-speech": [{ handle: "prompt", field: "directText" }],
  "text-to-audio": [{ handle: "prompt", field: "prompt" }],
  "generate-music": [{ handle: "prompt", field: "prompt" }],
  "video-to-video": [{ handle: "prompt", field: "prompt" }],
  "generate-script": [{ handle: "prompt", field: "prompt" }],
  "extend-video": [{ handle: "prompt", field: "prompt" }],
  "llm-chat": [
    { handle: "prompt", field: "userInput" },
    { handle: "system-prompt", field: "systemPrompt" },
  ],
  "speech-to-video": [{ handle: "prompt", field: "prompt" }],
  // Cinematic Avatar — generative prompt slot (handle id "prompt" → data.prompt).
  "cinematic-avatar": [{ handle: "prompt", field: "prompt" }],
}

/** Non-parameter node types whose `extractNodeOutput` produces text. */
const NON_PARAMETER_TEXT_SOURCES: ReadonlyArray<string> = [
  "text-prompt",
  "llm-chat",
  "combine-text",
  "split-text",
  "extract-field",
  "transcribe",
  "image-to-text",
  "suno-lyrics",
  "suno-style-boost",
  "forced-alignment",
  "qa-check",
  "filter-list",
  "deduplicate",
  "merge-lists",
  "sort-list",
  "json-process",
  "preview",
  "webhook-trigger",
  "schedule-trigger",
  "list",
]

/** Node types whose `extractNodeOutput` produces text (including parameter
 *  nodes whose hint is prose). Used by the auto-fill logic to avoid writing
 *  `{SomeVideo}` into a prompt when the source is an image/video/audio node.
 *
 *  The parameter portion is DERIVED from PARAMETER_NODE_TYPES minus the
 *  hint-exempt set, so a new picker joins automatically. A hand-list here
 *  once silently dropped the whole Object family (animal / vehicle / weapon /
 *  furniture / material) plus transition, character-fx, loop-subject, and the
 *  five sound pickers — canvas-legal prompt-handle wires that injected
 *  nothing. Guarded by main-text-handle.test.ts. */
export const TEXT_PRODUCING_SOURCE_TYPES: ReadonlySet<string> = new Set([
  ...NON_PARAMETER_TEXT_SOURCES,
  ...[...PARAMETER_NODE_TYPES].filter((t) => !HINT_EXEMPT_PARAMETER_TYPES.has(t)),
])
