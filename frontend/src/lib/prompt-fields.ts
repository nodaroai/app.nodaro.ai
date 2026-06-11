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

import type { SnippetMedia } from "@nodaro/shared"

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
  /** Node modality for prompt-snippet scoping — drives which snippet pool the
   *  "/" menu and Snippets button show for this node's prompt fields. REQUIRED
   *  so a new node cannot forget to declare it (compile error). */
  readonly media: SnippetMedia
}

export const NODE_PROMPT_FIELDS: Readonly<Record<string, PromptFieldSpec>> = {
  // ── Image ──
  // (`edit-image` / `image-to-image` are legacy types consolidated into
  // `modify-image`; they're not in the creatable node set, so a node of that
  // type never mounts and needs no entry here. The guard test enforces that.)
  "generate-image": { prompt: "prompt", negative: "negativePrompt", media: "image" },
  "modify-image": { prompt: "prompt", negative: "negativePrompt", icon: "paintbrush", media: "image" },
  "generate-mask": { prompt: "prompt", promptLabel: "What to mask", media: "image" },
  // ── Video ──
  "generate-video": { prompt: "prompt", negative: "negativePrompt", media: "video" },
  "text-to-video": { prompt: "prompt", negative: "negativePrompt", media: "video" },
  "image-to-video": { prompt: "prompt", negative: "negativePrompt", promptLabel: "Motion prompt", media: "video" },
  "video-to-video": { prompt: "prompt", negative: "negativePrompt", media: "video" },
  "extend-video": { prompt: "prompt", negative: "negativePrompt", media: "video" },
  "speech-to-video": { prompt: "prompt", negative: "negativePrompt", media: "video" },
  "motion-transfer": { prompt: "prompt", negative: "negativePrompt", media: "video" },
  // Cinematic Avatar (HeyGen) — generative prompt (NOT a verbatim script),
  // so it participates in the quick-edit Prompt modal like other AI video nodes.
  "cinematic-avatar": { prompt: "prompt", media: "video" },
  "video-sfx": { prompt: "prompt", negative: "negativePrompt", promptLabel: "Sound prompt", media: "audio" },
  "video-retake": { prompt: "prompt", promptLabel: "Retake prompt", media: "video" },
  // ── Audio / music ──
  "generate-music": { prompt: "prompt", media: "audio" },
  "suno-generate": { prompt: "prompt", media: "audio" },
  "text-to-audio": { prompt: "prompt", media: "audio" },
  // ── Text / LLM ──
  "text-prompt": { prompt: "text", promptLabel: "Text", media: "text" },
  "image-to-text": { prompt: "customPrompt", promptLabel: "Question", media: "text" },
  "llm-chat": { prompt: "userInput", promptLabel: "Prompt", media: "text" },
  // ── Speech / voice ──
  "text-to-speech": { prompt: "directText", promptLabel: "Text", media: "audio" },
  "voice-design": { prompt: "voiceDescription", promptLabel: "Voice description", media: "audio" },
  "voice-remix": { prompt: "voiceDescription", promptLabel: "Voice description", media: "audio" },
  "lip-sync": { prompt: "prompt", media: "audio" },
  // ── Suno (music) ──
  "suno-cover": { prompt: "prompt", media: "audio" },
  "suno-extend": { prompt: "prompt", media: "audio" },
  "suno-replace-section": { prompt: "prompt", media: "audio" },
  "suno-upload-extend": { prompt: "prompt", media: "audio" },
  "suno-add-vocals": { prompt: "prompt", media: "audio" },
  "suno-lyrics": { prompt: "prompt", media: "audio" },
  "suno-style-boost": { prompt: "content", promptLabel: "Style", media: "audio" },
  // ── Composition / FX ──
  "image-critic": { prompt: "prompt", promptLabel: "Criteria", media: "image" },
  "motion-graphics": { prompt: "motionPrompt", promptLabel: "Motion prompt", media: "video" },
  "3d-title": { prompt: "titlePrompt", promptLabel: "Title", media: "text" },
  // ── Script / alignment (their primary text field) ──
  "generate-script": { prompt: "styleGuide", promptLabel: "Style guide", media: "text" },
  "forced-alignment": { prompt: "transcript", promptLabel: "Transcript", media: "audio" },
}

/** The prompt-field spec for a node type, or undefined if it has none. */
export function getPromptFields(nodeType: string | undefined): PromptFieldSpec | undefined {
  return nodeType ? NODE_PROMPT_FIELDS[nodeType] : undefined
}

/** True when this node type has a registered, quick-editable prompt field. */
export function nodeHasPromptField(nodeType: string | undefined): boolean {
  return getPromptFields(nodeType) !== undefined
}

/** Snippet modality for a node type (drives the snippet pool), or undefined
 *  when the node has no prompt field. */
export function getSnippetMedia(nodeType: string | undefined): SnippetMedia | undefined {
  return getPromptFields(nodeType)?.media
}
