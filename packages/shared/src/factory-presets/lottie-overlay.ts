import type { FactoryPreset } from "./types.js"

/**
 * Factory presets for the `lottie-overlay` node — placement/timing briefs the
 * overlay planner LLM (see backend/src/prompts/lottie-overlay-system.ts) turns
 * into a timed LottieOverlayPlan over the source video.
 *
 * Each preset's `data` carries ONLY `overlayPrompt`. Deliberately NOT set:
 * `durationSeconds` (the plan timeline must track the SOURCE VIDEO — a baked
 * preset duration would silently truncate the plan on longer footage), `fps`
 * (node default 30), `llmModel` (the user's tier choice), and `overlayPlan`
 * (generated state — cleared generically via PRESET_APPLY_CLEAR_KEYS).
 *
 * Every prompt uses the Nodaro `{variable || default}` reference syntax
 * (node-refs.ts, shipped in PR #3250): run unedited and the default applies;
 * type a value over the token; or wire an upstream node whose label matches
 * the variable name and its output fills the slot at execution time. Both DAG
 * engines resolve the tokens for this node's typed prompt, and the planner's
 * system prompt reads any token that survives unresolved (direct API/MCP
 * calls) as "<variable> = <default>" — so the braces never leak into a plan.
 *
 * The "Connected Graphic" folder targets the asset wired into the node's
 * `lottie` input (e.g. a Motion Graphics node's authored Lottie); each of
 * those prompts ends with the exclusivity clause "only the connected graphic"
 * so the planner never substitutes catalog animations. The other folders name
 * their built-in catalog assets explicitly (LOTTIE_OVERLAY_CATALOG slugs).
 */
export const LOTTIE_OVERLAY_PRESETS: readonly FactoryPreset[] = [
  // ── Connected Graphic ─────────────────────────────────────────────────────
  {
    id: "lottie-overlay/connected-custom",
    name: "Overlay Connected Graphic",
    description: "Place the wired graphic — position, start time, size and play mode are variables.",
    group: "Connected Graphic",
    data: {
      overlayPrompt:
        "Overlay the connected graphic {position || centered} over the video, starting at {start time || 1 second}. Play it {play mode || once at its natural duration, then remove it}. Size it {size || to about half the frame width}, keeping its aspect ratio. Use only the connected graphic — no built-in animations.",
    },
  },
  {
    id: "lottie-overlay/connected-full-canvas",
    name: "Full-Canvas Graphic",
    description: "Stretch the wired graphic across the whole frame — for lower thirds, titles and other full-canvas overlays.",
    group: "Connected Graphic",
    data: {
      overlayPrompt:
        "Stretch the connected graphic across the entire frame (x 0, y 0, width 100, height 100) — it was authored on a full transparent canvas (a lower third, title or badge), so its own internal layout decides where content sits. Start it at {start time || 1 second} and play it {play mode || once at its natural duration}. Full opacity. Use only the connected graphic — no built-in animations.",
    },
  },
  {
    id: "lottie-overlay/connected-intro",
    name: "Intro Sting",
    description: "Open the video with the wired graphic, full-frame, then get out of the way.",
    group: "Connected Graphic",
    data: {
      overlayPrompt:
        "Open the video with the connected graphic as an intro sting: full-frame from the very first frame, playing once at its natural duration (no loop), then gone for the rest of the video. {treatment || Full opacity, no other effects.} Use only the connected graphic — no built-in animations.",
    },
  },
  {
    id: "lottie-overlay/connected-outro",
    name: "Outro Sting",
    description: "Close the video with the wired graphic, timed to end on the last frame.",
    group: "Connected Graphic",
    data: {
      overlayPrompt:
        "Close the video with the connected graphic: show it full-frame over the final {outro window || 4 seconds}, timed so it ends exactly on the video's last frame. If its natural duration is shorter than the window, start it later so it still finishes on the last frame; if it is a looping animation, loop it through the window. Use only the connected graphic — no built-in animations.",
    },
  },
  {
    id: "lottie-overlay/connected-corner-bug",
    name: "Corner Bug (Loop)",
    description: "The wired graphic as a small looping watermark in a corner.",
    group: "Connected Graphic",
    data: {
      overlayPrompt:
        "Pin the connected graphic as a small corner bug in the {corner || bottom-right} corner, about {size || 14}% of the frame width, at {opacity || 80}% opacity, looping from the first frame to the last. Keep a small margin (about 3%) from the edges so it never clips. Use only the connected graphic — no built-in animations.",
    },
  },
  {
    id: "lottie-overlay/connected-reaction-pop",
    name: "Reaction Pop",
    description: "Pop the wired graphic in at a moment, sized like a reaction sticker.",
    group: "Connected Graphic",
    data: {
      overlayPrompt:
        "Pop the connected graphic in at {moment || 2 seconds}, {position || in the lower-right area}, sized like a reaction sticker ({size || about 22}% of the frame width). Play it {play mode || once at its natural duration} and remove it. Use only the connected graphic — no built-in animations.",
    },
  },

  // ── Celebration & FX ──────────────────────────────────────────────────────
  {
    id: "lottie-overlay/celebration-moment",
    name: "Celebration Moment",
    description: "Confetti burst at a key moment with a short sparkle tail.",
    group: "Celebration & FX",
    data: {
      overlayPrompt:
        "Fire a confetti burst at {moment || 3 seconds} covering most of the frame, one-shot. As it lands, add twinkling star sparkles over the {sparkle area || upper third} for {sparkle window || 3 seconds}, then clear the frame. Use the built-in confetti-burst and stars-sparkle assets.",
    },
  },
  {
    id: "lottie-overlay/grand-finale",
    name: "Grand Finale",
    description: "Fireworks and confetti building over the video's final seconds.",
    group: "Celebration & FX",
    data: {
      overlayPrompt:
        "Build a finale across the last {finale window || 4 seconds} of the video: fireworks bursting over the upper half of the frame, plus a confetti burst as the window opens, both timed to end on the video's last frame. One-shot energy — nothing keeps looping past the end. Use the built-in fireworks and confetti-burst assets.",
    },
  },
  {
    id: "lottie-overlay/ambient-particles",
    name: "Ambient Particles",
    description: "Soft full-frame particles for the whole video; the footage stays the hero.",
    group: "Celebration & FX",
    data: {
      overlayPrompt:
        "Lay the built-in floating-particles asset over the whole video: full-frame, looping from the first frame to the last, at {opacity || 40}% opacity so the footage stays the hero. Calm and ambient — add nothing else.",
    },
  },

  // ── Reactions & Social ────────────────────────────────────────────────────
  {
    id: "lottie-overlay/heart-reaction",
    name: "Heart Reaction",
    description: "Pulsing heart near a corner at a moment.",
    group: "Reactions & Social",
    data: {
      overlayPrompt:
        "Show the built-in heart-pulse near the {corner || bottom-right} corner, starting at {moment || 2 seconds} and looping for {window || 3 seconds}, about {size || 18}% of the frame width, then remove it.",
    },
  },
  {
    id: "lottie-overlay/hype-combo",
    name: "Hype Combo",
    description: "Thumbs-up pop plus fire emoji at a key beat.",
    group: "Reactions & Social",
    data: {
      overlayPrompt:
        "At {moment || 2 seconds}, pop the built-in thumbs-up near the {corner || bottom-right} corner (one-shot) and the fire-flame emoji right beside it, looping for {window || 3 seconds}. Medium reaction size (15-20% of the frame width each), staggered a few frames apart so they land with rhythm.",
    },
  },

  // ── Emphasis & UI ─────────────────────────────────────────────────────────
  {
    id: "lottie-overlay/point-it-out",
    name: "Point It Out",
    description: "Animated arrow aimed at a spot for a few seconds.",
    group: "Emphasis & UI",
    data: {
      overlayPrompt:
        "Aim the built-in arrow-pointer at {target || the center of the frame} from {start time || 1 second} for {window || 2.5 seconds}, small (about 12-15% of the frame width), looping while visible, positioned beside the target so it points clearly without covering it.",
    },
  },
  {
    id: "lottie-overlay/success-beat",
    name: "Success Beat",
    description: "Checkmark pop to mark a win or completed step.",
    group: "Emphasis & UI",
    data: {
      overlayPrompt:
        "Mark a success beat: pop the built-in checkmark-success {position || centered} at {moment || 2 seconds}, about {size || 20}% of the frame width, playing once and then gone. Crisp and quick — no lingering.",
    },
  },
]
