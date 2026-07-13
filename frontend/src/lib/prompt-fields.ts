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

import type { SnippetMedia } from "@nodaro/prompts"

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
  /** True when this node renders a media-result preview body and therefore
   *  participates in inline-prompt mode (the `InlineNodePrompt` editor on the
   *  node face, centralized in `BaseNode`). REQUIRED (like `media`) so a new
   *  prompt node must consciously choose — compile error if omitted. The set of
   *  `inline: true` types is guarded in `prompt-fields.test.ts`. */
  readonly inline: boolean
}

export const NODE_PROMPT_FIELDS: Readonly<Record<string, PromptFieldSpec>> = {
  // ── Image ──
  // (`edit-image` / `image-to-image` are legacy types consolidated into
  // `modify-image`; they're not in the creatable node set, so a node of that
  // type never mounts and needs no entry here. The guard test enforces that.)
  "generate-image": { prompt: "prompt", negative: "negativePrompt", media: "image", inline: true },
  "modify-image": { prompt: "prompt", negative: "negativePrompt", icon: "paintbrush", media: "image", inline: true },
  "generate-mask": { prompt: "prompt", promptLabel: "What to mask", media: "image", inline: true },
  // ── Video ──
  "generate-video": { prompt: "prompt", negative: "negativePrompt", media: "video", inline: true },
  // Trimmed multi-segment stitch sibling of generate-video — no negativePrompt field.
  "generate-video-pro": { prompt: "prompt", media: "video", inline: true },
  // Span-replace sibling of generate-video-pro — no negativePrompt field.
  "edit-video-pro": { prompt: "prompt", media: "video", inline: true },
  "text-to-video": { prompt: "prompt", negative: "negativePrompt", media: "video", inline: true },
  "image-to-video": { prompt: "prompt", negative: "negativePrompt", promptLabel: "Motion prompt", media: "video", inline: true },
  "video-to-video": { prompt: "prompt", negative: "negativePrompt", media: "video", inline: true },
  "switchx": { prompt: "prompt", promptLabel: "Look prompt", media: "video", inline: true },
  "extend-video": { prompt: "prompt", negative: "negativePrompt", media: "video", inline: true },
  "speech-to-video": { prompt: "prompt", negative: "negativePrompt", media: "video", inline: true },
  "motion-transfer": { prompt: "prompt", negative: "negativePrompt", media: "video", inline: true },
  // Cinematic Avatar (HeyGen) — generative prompt (NOT a verbatim script),
  // so it participates in the quick-edit Prompt modal like other AI video nodes.
  "cinematic-avatar": { prompt: "prompt", media: "video", inline: true },
  "video-sfx": { prompt: "prompt", negative: "negativePrompt", promptLabel: "Sound prompt", media: "audio", inline: true },
  "video-retake": { prompt: "prompt", promptLabel: "Retake prompt", media: "video", inline: true },
  // ── Audio / music ──
  "generate-music": { prompt: "prompt", media: "audio", inline: true },
  "suno-generate": { prompt: "prompt", media: "audio", inline: true },
  "text-to-audio": { prompt: "prompt", media: "audio", inline: true },
  // ── Text / LLM (no media-result preview body → no inline editor) ──
  "text-prompt": { prompt: "text", promptLabel: "Text", media: "text", inline: false },
  "image-to-text": { prompt: "customPrompt", promptLabel: "Question", media: "text", inline: false },
  "llm-chat": { prompt: "userInput", promptLabel: "Prompt", media: "text", inline: false },
  // ── Speech / voice ──
  "text-to-speech": { prompt: "directText", promptLabel: "Text", media: "audio", inline: true },
  "voice-design": { prompt: "voiceDescription", promptLabel: "Voice description", media: "audio", inline: true },
  "voice-remix": { prompt: "voiceDescription", promptLabel: "Voice description", media: "audio", inline: true },
  "lip-sync": { prompt: "prompt", media: "audio", inline: true },
  // ── Suno (music) ──
  "suno-cover": { prompt: "prompt", media: "audio", inline: true },
  "suno-extend": { prompt: "prompt", media: "audio", inline: true },
  "suno-replace-section": { prompt: "prompt", media: "audio", inline: true },
  "suno-upload-extend": { prompt: "prompt", media: "audio", inline: true },
  // NOTE: `suno-add-vocals` is intentionally absent — its node has no
  // user-editable prompt (SunoAddVocalsData declares only `model`; the config
  // panel + backend route take taskId/audioId/model, never a prompt). A stale
  // entry here rendered a phantom Prompt editor in the quick-edit modal that
  // wrote to a `data.prompt` key nothing ever reads (the dead-field class the
  // guard test now catches via defaultData ownership).
  "suno-lyrics": { prompt: "prompt", media: "audio", inline: false },
  "suno-style-boost": { prompt: "content", promptLabel: "Style", media: "audio", inline: false },
  // ── Composition / FX (compact, no media-result preview → no inline editor) ──
  "image-critic": { prompt: "prompt", promptLabel: "Criteria", media: "image", inline: false },
  "motion-graphics": { prompt: "motionPrompt", promptLabel: "Motion prompt", media: "video", inline: false },
  "3d-title": { prompt: "titlePrompt", promptLabel: "Title", media: "text", inline: false },
  // ── Script / alignment (their primary text field) ──
  "generate-script": { prompt: "styleGuide", promptLabel: "Style guide", media: "text", inline: false },
  "forced-alignment": { prompt: "transcript", promptLabel: "Transcript", media: "audio", inline: false },
  // Video Analysis — its focus hint is the editable prompt (renders a JSON scene
  // table, not a media preview → no inline editor).
  "video-analysis": { prompt: "analysisFocus", promptLabel: "Analysis focus", media: "video", inline: false },
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

/** True when this node type renders the inline on-node prompt editor — the
 *  media-preview nodes (image/video/audio result body). Single source for
 *  BaseNode's centralized `InlineNodePrompt` rendering and the gold nodes'
 *  `showInline` derivation (`useInlinePromptActive`). */
export function nodeHasInlinePrompt(nodeType: string | undefined): boolean {
  return getPromptFields(nodeType)?.inline === true
}
