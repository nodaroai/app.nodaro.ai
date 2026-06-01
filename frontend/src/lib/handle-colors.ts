/**
 * CANONICAL handle/edge color map — the single source of truth for node
 * handle pip colors AND edge stroke colors, keyed by DATA TYPE.
 *
 * Every `HandleWithPopover` `color` prop and every typed edge MUST derive its
 * color from this map (reference `HANDLE_COLORS.<type>` — never hardcode a
 * hex). A guard test (`handle-colors.test.ts`) fails CI if a node hardcodes a
 * hex on a handle, so colors can never again drift from their type.
 *
 * Two older maps now derive from this one (no separate literals):
 *   - `PICKER_FAMILY_COLORS` (picker-handles.ts) — picker output pips
 *   - `DATA_HANDLE_COLORS`   (data-handles.ts)   — data/list node handles
 * and `TEXT_HANDLE_COLOR` (handle-with-popover.tsx) is an alias of `.text`.
 *
 * Reserved meaning that is NOT a handle type: the brand pink #ff0073 signals
 * "action" (Run button, selection ring) — it must never color a handle/edge.
 */
export const HANDLE_COLORS = {
  // ── Text / string ────────────────────────────────────────────────────
  text: "#3B82F6", // blue-500 — prompt, text, dialogue, system-prompt, URL/string inputs, payload/message
  // ── Image family ─────────────────────────────────────────────────────
  image: "#22D3EE", // cyan — image, references, portrait, start-frame, image-url
  imageRef: "#34D399", // emerald — image references (kept distinct from a single image input)
  endFrame: "#06B6D4", // teal — end frame (distinct from the cyan start frame)
  // ── Video / motion ───────────────────────────────────────────────────
  video: "#A78BFA", // violet — video, video-refs, source video, motion, scenes
  // ── Audio ────────────────────────────────────────────────────────────
  audio: "#F59E0B", // amber — audio, voice, music, sfx, vocals, ref-audio, audio-style
  audioRef: "#FACC15", // gold — audio references (kept distinct)
  // ── Look / params ────────────────────────────────────────────────────
  look: "#818CF8", // indigo — look, elements, cinematography pickers, json, branches
  // ── Multimodal reference ─────────────────────────────────────────────
  reference: "#E879F9", // fuchsia — mixed/any reference input (image + video + audio + text), e.g. Generate Text "References"
  // ── Identity / refs ──────────────────────────────────────────────────
  identity: "#F472B6", // pink — character, location, assets, voice id/persona
  // ── Single-purpose types ─────────────────────────────────────────────
  negative: "#ef4444", // red — negative prompt, rejected
  face: "#FB923C", // orange — face
  mask: "#A855F7", // purple — mask
  approve: "#22C55E", // green — approved
  list: "#14B8A6", // teal — list / data-node flow
  variables: "#F97316", // orange — variables
  // ── Generic / control ────────────────────────────────────────────────
  control: "#94A3B8", // slate — generic in/out, result, reduced, inputs, parent, composition
} as const

export type HandleColorType = keyof typeof HANDLE_COLORS
