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
  "generate-image": [{ handle: "in", field: "prompt" }],
  "text-to-video": [{ handle: "in", field: "prompt" }],
  "text-to-speech": [{ handle: "in", field: "directText" }],
  "text-to-audio": [{ handle: "in", field: "prompt" }],
  "generate-music": [{ handle: "in", field: "prompt" }],
  "video-to-video": [{ handle: "in", field: "prompt" }],
  "ai-writer": [{ handle: "in", field: "userInput" }],
  "generate-script": [{ handle: "in", field: "prompt" }],
  "extend-video": [{ handle: "in", field: "prompt" }],
  "llm-chat": [
    { handle: "prompt", field: "userInput" },
    { handle: "system-prompt", field: "systemPrompt" },
  ],
  "speech-to-video": [{ handle: "prompt", field: "prompt" }],
}

/** Node types whose `extractNodeOutput` produces text (including parameter
 *  nodes whose hint is prose). Used by the auto-fill logic to avoid writing
 *  `{SomeVideo}` into a prompt when the source is an image/video/audio node. */
export const TEXT_PRODUCING_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "text-prompt",
  "llm-chat",
  "combine-text",
  "split-text",
  "extract-field",
  "ai-writer",
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
  "loop",
  // Parameter nodes — their extracted output is the prompt hint.
  "tone",
  "style-guide",
  "motion",
  "camera-motion",
  "framing",
  "lens",
  "camera-format",
  "lighting",
  "color-look",
  "atmosphere",
  "action-fx",
  "style",
  "setting",
  "person",
  "mood",
  "photographer",
  "aesthetic",
  "era",
  "pose",
  "styling",
  "photo-genre",
  "backdrop",
  "held-prop",
  "temporal",
  "exposure-settings",
  "render-quality",
  "composition-effects",
  "post-process-effects",
])
