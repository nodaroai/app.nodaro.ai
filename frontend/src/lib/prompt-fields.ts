/**
 * Single source of truth: which data field(s) hold a node's user-editable
 * prompt text. Drives the quick-edit Prompt modal so it can work generically
 * across every AI node without each call site hardcoding a field name.
 *
 * Most nodes store the prompt in `data.prompt`, but several don't
 * (`text-prompt` → `text`, `image-to-text` → `customPrompt`, …) — this map is
 * where that knowledge lives, once.
 *
 * INVARIANT: every node that exposes a user-editable prompt MUST have an entry
 * here, or the quick-edit modal silently does nothing for it. A guard test
 * (`prompt-fields.test.ts`) keeps this in sync with the node set.
 *
 * This module is intentionally pure data (no React/lucide imports) so it can be
 * pulled into the app-runtime bundle and any test without dragging in the icon
 * library. The string `icon` kind is mapped to a concrete lucide component in
 * `prompt-edit-button.tsx` (`getPromptIcon`), the only place that renders it.
 */

/** Which lucide glyph a node's prompt affordance uses. Kept as a string so this
 *  module stays icon-library-free; mapped to a component in the strip button. */
export type PromptIconKind = "pencil" | "paintbrush"

export interface PromptFieldSpec {
  /** Data key holding the primary prompt (e.g. "prompt", "text", "customPrompt"). */
  readonly prompt: string
  /** Data key holding the negative prompt, when the node supports one. */
  readonly negative?: string
  /** Label override for the primary field (defaults to "Prompt"). */
  readonly promptLabel?: string
  /** Icon for the prompt affordance (strip button + modal title). Defaults to a
   *  pencil; image-editing nodes use a paintbrush to read as "edit". */
  readonly icon?: PromptIconKind
}

export const NODE_PROMPT_FIELDS: Readonly<Record<string, PromptFieldSpec>> = {
  // ── Image ──
  // (`edit-image` / `image-to-image` are legacy types consolidated into
  // `modify-image`; they're not in the creatable node set, so a node of that
  // type never mounts and needs no entry here. The guard test enforces that.)
  "generate-image": { prompt: "prompt", negative: "negativePrompt" },
  "modify-image": { prompt: "prompt", negative: "negativePrompt", icon: "paintbrush" },
  "generate-mask": { prompt: "prompt", promptLabel: "What to mask" },
  // ── Video ──
  "generate-video": { prompt: "prompt", negative: "negativePrompt" },
  "text-to-video": { prompt: "prompt", negative: "negativePrompt" },
  "image-to-video": { prompt: "prompt", negative: "negativePrompt", promptLabel: "Motion prompt" },
  "video-to-video": { prompt: "prompt", negative: "negativePrompt" },
  "extend-video": { prompt: "prompt", negative: "negativePrompt" },
  "speech-to-video": { prompt: "prompt", negative: "negativePrompt" },
  "motion-transfer": { prompt: "prompt", negative: "negativePrompt" },
  "video-sfx": { prompt: "prompt", negative: "negativePrompt", promptLabel: "Sound prompt" },
  "video-retake": { prompt: "prompt", promptLabel: "Retake prompt" },
  // ── Audio / music ──
  "generate-music": { prompt: "prompt" },
  "suno-generate": { prompt: "prompt" },
  "text-to-audio": { prompt: "prompt" },
  // ── Text / LLM ──
  "text-prompt": { prompt: "text", promptLabel: "Text" },
  "image-to-text": { prompt: "customPrompt", promptLabel: "Question" },
  "llm-chat": { prompt: "userInput", promptLabel: "Prompt" },
  // ── Speech / voice ──
  "text-to-speech": { prompt: "directText", promptLabel: "Text" },
  "voice-design": { prompt: "voiceDescription", promptLabel: "Voice description" },
  "voice-remix": { prompt: "voiceDescription", promptLabel: "Voice description" },
  "lip-sync": { prompt: "prompt" },
  // ── Suno (music) ──
  "suno-cover": { prompt: "prompt" },
  "suno-extend": { prompt: "prompt" },
  "suno-replace-section": { prompt: "prompt" },
  "suno-upload-extend": { prompt: "prompt" },
  "suno-add-vocals": { prompt: "prompt" },
  "suno-lyrics": { prompt: "prompt" },
  "suno-style-boost": { prompt: "content", promptLabel: "Style" },
  // ── Composition / FX ──
  "image-critic": { prompt: "prompt", promptLabel: "Criteria" },
  "motion-graphics": { prompt: "motionPrompt", promptLabel: "Motion prompt" },
  "3d-title": { prompt: "titlePrompt", promptLabel: "Title" },
  // ── Script / alignment (their primary text field) ──
  "generate-script": { prompt: "styleGuide", promptLabel: "Style guide" },
  "forced-alignment": { prompt: "text", promptLabel: "Text" },
}

/** The prompt-field spec for a node type, or undefined if it has none. */
export function getPromptFields(nodeType: string | undefined): PromptFieldSpec | undefined {
  return nodeType ? NODE_PROMPT_FIELDS[nodeType] : undefined
}

/** True when this node type has a registered, quick-editable prompt field. */
export function nodeHasPromptField(nodeType: string | undefined): boolean {
  return getPromptFields(nodeType) !== undefined
}
