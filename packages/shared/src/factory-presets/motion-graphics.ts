import type { FactoryPreset } from "./types.js"

/**
 * Factory presets for the `motion-graphics` node — all targeting the Lottie
 * engine (`engine: "lottie"`), which has an LLM author a complete, valid Lottie
 * (Bodymovin) JSON document with named editable slots.
 *
 * Each preset's `data` sets every portable configurable field (engine,
 * motionPrompt, aspectRatio, durationSeconds, backgroundColor) so switching
 * presets never leaves stale canvas settings. `fps` (node default 30) and
 * `llmModel` (the user's tier choice) are deliberately NOT set. `label` is NOT
 * carried either — factory `data` is capture-shaped (the FactoryPreset.data
 * contract excludes label/fieldMappings/runtime keys, pinned by the
 * `extractPresetData(data).toEqual(data)` round-trip test); the dropdown already
 * surfaces the active preset's `name` in its trigger. No preset carries
 * `motionPlan` — generated-plan staleness is solved generically via
 * PRESET_APPLY_CLEAR_KEYS (see node-preset-extract.ts), not per-preset.
 *
 * The prompts are written to work WITH the engine's contract (see
 * backend/src/prompts/lottie-graphic-system.ts): group-wrapped shapes, 0–1
 * colors, a root `slots` map with `{"sid"}` refs, raw-string text slots, the
 * 20-font safelist, vector-only output, ≤50 layers, and seamless-loop or
 * exit-before-`op` discipline. Every prompt ends with
 * `Expose slots: <sids>.` using stable lowerCamelCase sids so slot edits
 * survive regeneration and published-app field exposure is dependable.
 *
 * fps is 30, so frame counts below map to seconds as frames = seconds × 30
 * (a 5s preset = 150 frames; "20 frames before the end" = 0.67s before `op`).
 */
export const MOTION_GRAPHICS_PRESETS: readonly FactoryPreset[] = [
  // ── Titles & Text ─────────────────────────────────────────────────────────
  {
    id: "motion-graphics/lower-third",
    name: "Lower Third",
    description: "Animated lower third with editable name, role and accent color.",
    group: "Titles & Text",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 5,
      backgroundColor: "#00000000",
      motionPrompt:
        "Lower third for a name and role, anchored in the lower-left title-safe area (x ≈ 8% of width, baseline ≈ 84% of height). A slim accent bar (the brand color) slides in from the left with a slight overshoot and settles over about 14 frames; the name in bold white rises and fades in above the role in lighter gray, staggered 6–8 frames after the bar, each easing out. Hold steady through the middle, then everything exits with a clean fade and a small slide-left completing 20 frames before the end — nothing cuts mid-motion. Palette: one saturated brand accent plus white and a neutral gray, restrained and broadcast-clean. Transparent background — this overlays footage, so add no full-frame backdrop. One-shot, not looped: the entrance plays once and the exit finishes before the out point. Use the placeholder name \"Jane Doe\" and role \"Product Designer\" so users retype their own. Expose slots: primaryColor, nameText, roleText.",
    },
  },
  {
    id: "motion-graphics/title-card",
    name: "Title Card",
    description: "Centered title and subtitle with a confident scale-up entrance.",
    group: "Titles & Text",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 4,
      backgroundColor: "#0b0b12",
      motionPrompt:
        "A centered title card with a clear type hierarchy: a large bold headline above a smaller subtitle, generously spaced and optically centered. The headline scales up from about 92% with a touch of overshoot and fades in over 16 frames; the subtitle follows 8 frames later, rising a few pixels as it fades. A thin decorative accent rule draws in beneath the title using a trim-path reveal. Hold the composition still in the middle, then let everything fade out together completing 20 frames before the end. Easing: ease-out on the hero scale, gentle ease on supporting elements. Palette: white and light-gray type with a single accent-colored rule, set against the dark opaque background. One-shot, not looped — the exit completes before the out point. Use the placeholder title \"Your Title Here\" and subtitle \"A short supporting line\". Expose slots: primaryColor, titleText, subtitleText.",
    },
  },
  {
    id: "motion-graphics/kinetic-typography",
    name: "Kinetic Typography",
    description: "Three words cascade in with punchy staggered motion.",
    group: "Titles & Text",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 5,
      backgroundColor: "#0a0a0a",
      motionPrompt:
        "Punchy kinetic typography: three bold words stacked or marching across the center, each its own text layer, entering in a staggered cascade 7–9 frames apart. Vary the rhythm — the first word slides up from below with overshoot, the second snaps in from the left, the third scales up from 85% and settles — so the motion feels choreographed, not uniform. Use a heavy display family from the safelist (Anton, Bebas Neue or Oswald). One word is rendered in the accent color for emphasis; the rest are white. Hold the full phrase briefly, then exit each word on a quick staggered fade completing 20 frames before the end. Dark opaque background, no full-frame rectangle beyond the stated bg. One-shot, not looped. Use placeholder words \"MAKE\", \"IT\", \"MOVE\" so users retype their own copy. Expose slots: accentColor, wordOne, wordTwo, wordThree.",
    },
  },
  {
    id: "motion-graphics/quote-card",
    name: "Quote Card",
    description: "Elegant pull-quote with attribution and a draw-on accent mark.",
    group: "Titles & Text",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 6,
      backgroundColor: "#11131a",
      motionPrompt:
        "An elegant pull-quote card. A large accent-colored quotation mark draws on first via a trim-path reveal over about 18 frames, then the quote text fades and rises into the center set in a refined serif from the safelist (Playfair Display or Lora). The attribution line fades in 10 frames later, smaller and in lighter gray, beneath a short accent rule that wipes in from the left. Let it breathe in the middle of the timeline, then fade the whole group out together completing 24 frames before the end. Easing is soft and unhurried throughout — ease-out, no overshoot — to match the editorial tone. Palette: warm white type, a muted gray attribution, and one accent color on the quote mark and rule, over the dark opaque background. One-shot, not looped. Use the placeholder quote \"Design is intelligence made visible.\" and attribution \"— Alina Wheeler\". Expose slots: accentColor, quoteText, attributionText.",
    },
  },
  {
    id: "motion-graphics/end-card-cta",
    name: "End Card (CTA)",
    description: "Outro card with a headline and a pulsing call-to-action button.",
    group: "Titles & Text",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 5,
      backgroundColor: "#0b0b12",
      motionPrompt:
        "An outro end card that drives action. A bold white headline scales up from 90% with a hint of overshoot and fades in over 16 frames, centered in the upper-middle. Below it, a rounded call-to-action button (filled with the primary color, label in white) springs in from slightly below 10 frames later with an anticipation-and-overshoot settle. Once settled, the button breathes with a subtle scale pulse (about 100%→104%→100%) on a gentle loop to draw the eye. Keep the headline static after it lands. Exit is optional and soft — if present, fade only, completing 20 frames before the end. Palette: white headline, one saturated primary on the button, dark opaque background. The headline is one-shot; the button's pulse loops seamlessly. Use the placeholder headline \"Thanks for watching\" and CTA label \"SUBSCRIBE\". Expose slots: primaryColor, headlineText, ctaText.",
    },
  },

  // ── Intros & Logos ────────────────────────────────────────────────────────
  {
    id: "motion-graphics/logo-sting",
    name: "Logo Sting",
    description: "Punchy brand reveal with anticipation and overshoot.",
    group: "Intros & Logos",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 4,
      backgroundColor: "#000000",
      motionPrompt:
        "A tight, punchy logo sting built from vector shapes. A simple geometric brand mark (in the brand color) performs the hero move with real anticipation and overshoot: it scales down slightly and counter-rotates a few degrees over the first 8 frames, then snaps up to full size, overshooting to about 108% before settling back over the next 12 frames. As the mark lands, the brand name wordmark wipes or fades in beside or beneath it, 6 frames behind, easing out. Hold the locked-up logo still through the middle. Exit on a clean fade (and optional slight scale-down) completing 20 frames before the end — never cut to black mid-motion. Keep total action under two seconds. Palette: the brand color plus white, restrained. Opaque black background. One-shot, not looped. Use the placeholder brand name \"ACME\". Expose slots: brandColor, brandName.",
    },
  },
  {
    id: "motion-graphics/channel-intro",
    name: "Channel Intro",
    description: "Energetic channel open with name, tagline and accent shapes.",
    group: "Intros & Logos",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 5,
      backgroundColor: "#0a0a14",
      motionPrompt:
        "An energetic channel intro. Two or three accent-colored geometric shapes (a bar, a circle, a triangle) sweep in from opposite edges with overshoot and converge toward center over the first 18 frames, establishing rhythm. The channel name then scales up from 88% with overshoot and fades in, set in a bold family from the safelist (Montserrat or Poppins); the tagline fades in 8 frames later beneath it in lighter gray. The accent shapes settle into a tidy lockup behind or beside the type. Hold briefly, then exit everything together with a fade and a small slide completing 20 frames before the end. Easing: snappy overshoot on the shapes and the name, ease-out on the tagline. Palette: one or two accent colors plus white over the dark opaque background. One-shot, not looped. Use the placeholder channel name \"My Channel\" and tagline \"new videos every week\". Expose slots: primaryColor, channelName, taglineText.",
    },
  },
  {
    id: "motion-graphics/countdown",
    name: "Countdown",
    description: "5-second ring countdown from 5 to 1 with a sweeping arc.",
    group: "Intros & Logos",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 6,
      backgroundColor: "#000000",
      motionPrompt:
        "A centered countdown from 5 down to 1. A circular ring (stroked in the ring color) sits in the center; a second arc in the same color sweeps around it once per second via an animated trim path, completing one full revolution every 30 frames as a steady visual metronome. Inside the ring, a SINGLE text layer shows the current number in a large bold face (number color), keyframed once per second so the displayed digit steps 5 → 4 → 3 → 2 → 1 across the timeline — the digits are deliberately baked into the keyframes, NOT slotted. On each step, give the number a quick scale-pop (about 120%→100%) and a fast cross-fade so the change reads crisply. After \"1\", let the ring and number fade out together completing 20 frames before the end so nothing cuts abruptly. Palette: a single accent ring color and a white-ish number color over the opaque black background. One-shot, not looped. Expose slots: ringColor, numberColor.",
    },
  },

  // ── Social & CTA ──────────────────────────────────────────────────────────
  {
    id: "motion-graphics/subscribe-reminder",
    name: "Subscribe Reminder",
    description: "Overlay subscribe button that pops in and pulses.",
    group: "Social & CTA",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 4,
      backgroundColor: "#00000000",
      motionPrompt:
        "An overlay subscribe button for the lower-third area (lower-center or lower-left, inside the title-safe margin). A rounded pill filled with the button color springs in from slightly below with anticipation and overshoot, settling over about 12 frames; the button label in bold white fades in 4 frames behind it. A small play-triangle or bell glyph (white, vector) sits to the left of the label and gives a quick wiggle-free nod — a single tilt and return — as the button lands. Once settled, the whole button breathes with a gentle scale pulse (100%→104%→100%) on a seamless loop to attract attention, then fades out cleanly completing 16 frames before the end. Palette: one saturated button color plus white. Transparent background — this overlays footage, so add no backdrop. The entrance is one-shot; the pulse loops seamlessly. Use the placeholder label \"SUBSCRIBE\". Expose slots: buttonColor, buttonText.",
    },
  },
  {
    id: "motion-graphics/like-follow-bug",
    name: "Like + Follow Bug",
    description: "Corner bug with a heart pop and editable handle.",
    group: "Social & CTA",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 3,
      backgroundColor: "#00000000",
      motionPrompt:
        "A compact corner bug for the lower-left, sized small so it never blocks the shot. A heart icon built from a vector path (filled with the accent color) pops in with anticipation and overshoot — scaling from 0 with a slight squash-and-stretch over about 10 frames — and emits two or three small accent particles that fan out and fade as it lands. Beside the heart, a handle label in bold white slides in from the left 4 frames behind, easing out. Hold the lockup briefly, then exit with a quick fade and slight slide-down completing 12 frames before the end. Keep it lively but short — under three seconds total. Palette: one accent color on the heart and particles plus white text. Transparent background — overlays footage, no backdrop. One-shot, not looped. Use the placeholder handle \"@yourhandle\". Expose slots: accentColor, handleText.",
    },
  },
  {
    id: "motion-graphics/sale-badge",
    name: "Sale Badge",
    description: "Square promo badge that stamps in with a starburst.",
    group: "Social & CTA",
    data: {
      engine: "lottie",
      aspectRatio: "1:1",
      durationSeconds: 3,
      backgroundColor: "#00000000",
      motionPrompt:
        "A bold square promo badge centered in frame. A starburst or rounded medallion (filled with the badge color, built as a star/polygon or circle group) stamps in with strong anticipation and overshoot — counter-scaling down then snapping up past 100% to about 110% and settling over 12 frames, with a small counter-rotation for energy. The headline sale text scales up inside it in heavy white type from the safelist (Anton or Bebas Neue) 4 frames behind, and a smaller detail line fades in below 6 frames after that. Add a subtle continuous slow rotation (a few degrees back and forth) to keep the badge alive. Exit on a quick scale-down and fade completing 14 frames before the end. Palette: one vivid badge color plus white text. Transparent background — overlays a product shot or post, no backdrop. One-shot entrance; the gentle rotation loops seamlessly. Use the placeholder sale text \"50% OFF\" and detail \"this weekend only\". Expose slots: badgeColor, saleText, detailText.",
    },
  },
  {
    id: "motion-graphics/story-highlight",
    name: "Story Highlight",
    description: "Vertical story title card with headline and subtext.",
    group: "Social & CTA",
    data: {
      engine: "lottie",
      aspectRatio: "9:16",
      durationSeconds: 5,
      backgroundColor: "#10101a",
      motionPrompt:
        "A vertical (portrait) story highlight title card composed for the upper-middle of a tall phone frame, clear of phone UI at top and bottom. A short accent bar wipes in from the left, then a punchy headline scales up from 90% with overshoot and fades in beneath it in bold white (Poppins or Montserrat from the safelist); a subtext line fades in 8 frames later in lighter gray. A couple of small accent dots or a thin underline animate in to add rhythm. Hold the layout still through the middle, then fade everything out together completing 20 frames before the end. Easing: overshoot on the headline, ease-out on supporting elements. Palette: white and gray type with one accent color, over the dark opaque background. One-shot, not looped. Use the placeholder headline \"BEHIND THE SCENES\" and subtext \"swipe up to watch\". Expose slots: primaryColor, headlineText, subText.",
    },
  },

  // ── UI & Icons ────────────────────────────────────────────────────────────
  {
    id: "motion-graphics/loader-spinner",
    name: "Loader / Spinner",
    description: "Seamless dot-trail loading spinner for UI overlays.",
    group: "UI & Icons",
    data: {
      engine: "lottie",
      aspectRatio: "1:1",
      durationSeconds: 3,
      backgroundColor: "#00000000",
      motionPrompt:
        "A clean, seamless loading spinner centered in frame, built for UI overlays. Arrange a ring of small dots (about 8–12, group-wrapped ellipses) around a circle; rotate the whole group continuously and smoothly so it completes an exact whole number of revolutions across the timeline and the last frame matches the first — a perfect seamless loop with no visible seam or stutter. Drive a chasing fade around the ring so each dot brightens then dims in sequence (a trailing comet effect): the lead dots use the dot color at full opacity and the tail fades toward the trail color. Use linear, constant-speed rotation (mechanical, not eased) so it spins forever evenly. Keep it under the layer budget by reusing a repeater or a tight set of dot groups. Transparent background — overlays a UI, no backdrop. Seamless loop — every animated property's last keyframe repeats its first. Expose slots: dotColor, trailColor.",
    },
  },
  {
    id: "motion-graphics/success-check",
    name: "Success Check",
    description: "Checkmark that draws on inside a popping ring.",
    group: "UI & Icons",
    data: {
      engine: "lottie",
      aspectRatio: "1:1",
      durationSeconds: 2,
      backgroundColor: "#00000000",
      motionPrompt:
        "A satisfying success confirmation centered in frame. A circular ring (stroked in the ring color) scales in from about 0 with a crisp overshoot and settles over the first 12 frames. The moment it lands, a checkmark drawn as a single stroked path (in the stroke color) draws on left-to-right via an animated trim path from 0% to 100% over about 10 frames, with a slight ease-out so the tick snaps confidently at the end. Add a single soft pulse on the ring as the check completes (a brief scale to ~105% and back). Hold the finished mark, then fade the whole group out completing 8 frames before the end so it doesn't pop off. Easing: overshoot on the ring, ease-out on the trim. Palette: a positive accent on both the ring and the check. Transparent background — overlays a UI, no backdrop. One-shot, not looped. Expose slots: strokeColor, ringColor.",
    },
  },
  {
    id: "motion-graphics/error-cross",
    name: "Error Cross",
    description: "Error X that draws on inside a shaking ring.",
    group: "UI & Icons",
    data: {
      engine: "lottie",
      aspectRatio: "1:1",
      durationSeconds: 2,
      backgroundColor: "#00000000",
      motionPrompt:
        "A clear error indicator centered in frame. A circular ring (stroked in the ring color) scales in with overshoot over the first 12 frames. Then an X drawn as two stroked paths (in the stroke color) draws on in quick succession via animated trim paths — the first stroke over about 6 frames, the second starting 3 frames later — each easing out so they land decisively. As the X completes, give the whole group a short, sharp horizontal shake (a damped left-right wobble over ~8 frames) to signal failure, then settle. Hold the finished mark, then fade out completing 8 frames before the end. Easing: overshoot on the ring, ease-out on the strokes, a quick damped shake on the lockup. Palette: an alert accent on both the ring and the cross. Transparent background — overlays a UI, no backdrop. One-shot, not looped. Expose slots: strokeColor, ringColor.",
    },
  },
  {
    id: "motion-graphics/progress-bar",
    name: "Progress Bar",
    description: "Horizontal progress bar that fills with an editable label.",
    group: "UI & Icons",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 4,
      backgroundColor: "#00000000",
      motionPrompt:
        "A horizontal progress bar centered in frame. A rounded track (filled with the track color) fades in first; then a fill bar (the bar color) grows from left to right inside it — animate the fill rectangle's width (or use a left-anchored scale on x) from 0 to full over about 60 frames with an ease-in-out so it accelerates then eases to completion. A short label sits above or beside the track in bold white and fades in as the fill starts. Optionally let a soft highlight sweep along the fill as it grows. When the bar reaches full, give it a small confirming pulse, hold, then fade the whole group out completing 16 frames before the end. Easing: ease-in-out on the fill, ease-out on the label. Palette: a muted track color and one saturated bar color, plus white text. Transparent background — overlays a UI, no backdrop. One-shot, not looped. Use the placeholder label \"Loading…\". Expose slots: barColor, trackColor, labelText.",
    },
  },
  {
    id: "motion-graphics/notification-pop",
    name: "Notification Pop",
    description: "Toast notification card that slides in with title and body.",
    group: "UI & Icons",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 3,
      backgroundColor: "#00000000",
      motionPrompt:
        "A toast notification card that slides into the top-right corner. A rounded rectangle card (filled with the card color) springs in from above-right with anticipation and overshoot, settling over about 12 frames. A small accent dot or icon pops in on the left of the card, then the title text fades and slides in 4 frames behind in bold white, with the body line following 6 frames later in lighter gray. Keep the card crisp and clean — a subtle drop of opacity from the bg color is fine, but no heavy effects. Hold the toast for the middle of the timeline, then slide it back out up-and-right with a fade completing 14 frames before the end. Easing: overshoot on the card entrance, ease-out on the text. Palette: a card color, white title, gray body, and one small accent. Transparent background — overlays a UI, no backdrop. One-shot, not looped. Use the placeholder title \"New message\" and body \"You have 1 unread notification\". Expose slots: cardColor, titleText, bodyText.",
    },
  },

  // ── FX Overlays ───────────────────────────────────────────────────────────
  {
    id: "motion-graphics/confetti-burst",
    name: "Confetti Burst",
    description: "Celebratory confetti burst overlay in four colors.",
    group: "FX Overlays",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 4,
      backgroundColor: "#00000000",
      motionPrompt:
        "A celebratory confetti burst that overlays footage. Emit many small vector confetti pieces (tiny rectangles and a few circles, group-wrapped) from a point near the lower-center, fountaining up and outward then drifting down under a gentle gravity-like ease. Stagger their launch over the first 10–14 frames so the burst feels organic, give each a different launch angle, speed, rotation and a slow tumble, and fade each piece out as it falls so the frame clears by the end. Use a repeater to multiply pieces and stay well under the 50-layer budget rather than authoring dozens of individual layers. Spread the pieces across four colors — colorA, colorB, colorC, colorD — for a festive mix. Linear-ish motion on launch easing into a soft fall. Transparent background — overlays footage, so add no backdrop. One-shot, not looped: the burst plays once and fully clears before the out point. Expose slots: colorA, colorB, colorC, colorD.",
    },
  },
  {
    id: "motion-graphics/sparkle-shimmer",
    name: "Sparkle Shimmer",
    description: "Looping sparkle twinkles for a magical overlay.",
    group: "FX Overlays",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 4,
      backgroundColor: "#00000000",
      motionPrompt:
        "A gentle, looping sparkle shimmer that overlays footage. Scatter a dozen or so four-point star sparkles (vector star/polygon paths or thin crossed strokes, group-wrapped) across the frame at varied sizes. Each sparkle twinkles by scaling up from 0 and back down while its opacity rises and falls, on its own offset cycle so the field shimmers continuously rather than pulsing in unison — stagger their phase across the timeline. Add a slow, subtle rotation to a few for life. Keep every sparkle the sparkle color (let opacity and scale carry the variation). Use a repeater or a compact set of groups to stay under the layer budget. Soft ease-in-out on each twinkle. Transparent background — overlays footage, so add no backdrop. Seamless loop — every sparkle's last keyframe returns exactly to its first so the shimmer repeats without a seam. Expose slots: sparkleColor.",
    },
  },
  {
    id: "motion-graphics/speed-lines",
    name: "Speed Lines",
    description: "Anime-style speed lines whooshing across the frame.",
    group: "FX Overlays",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 2,
      backgroundColor: "#00000000",
      motionPrompt:
        "A short, high-energy burst of anime-style speed lines that overlays footage. Author a set of thin horizontal streaks (narrow tapered rectangles or stroked paths, group-wrapped) at varied vertical positions and lengths; whoosh them across the frame left-to-right (or converging toward center) with a fast linear motion, staggered 1–2 frames apart over the first 10 frames so they read as a rushing swarm. Each line fades in as it enters and fades out as it exits so none lingers. Keep them all the line color and lean on length, position and timing for variety; use a repeater to multiply streaks and stay well under the layer budget. Fast, mechanical linear motion — no easing — for impact. Transparent background — overlays footage, so add no backdrop. One-shot, not looped: the whoosh fires once and clears before the out point. Expose slots: lineColor.",
    },
  },

  // ── Backgrounds ───────────────────────────────────────────────────────────
  {
    id: "motion-graphics/gradient-blob-loop",
    name: "Gradient Blob Loop",
    description: "Slow morphing gradient blobs for a looping backdrop.",
    group: "Backgrounds",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 8,
      backgroundColor: "#0a0a12",
      motionPrompt:
        "A calm, full-frame animated backdrop of slow-morphing gradient blobs, designed to loop forever behind other content. Place two or three large soft organic blobs (big group-wrapped ellipses or gradient-filled paths) using colorA and colorB, drifting slowly across the frame on gentle looping paths and breathing in scale, so the color softly shifts and overlaps over the full eight seconds. Keep the motion unhurried and continuous with smooth ease-in-out, never sharp. Because this is a standalone backdrop, fill the frame edge-to-edge with the dark opaque base and let the blobs float over it — this preset is allowed a full-frame background. Seamless loop — every blob's position, scale and any gradient stop returns exactly to its starting value on the last frame so the eight-second cycle repeats with no visible seam. Palette: two accent colors blending over the dark base. Expose slots: colorA, colorB.",
    },
  },
  {
    id: "motion-graphics/geometric-pattern-loop",
    name: "Geometric Pattern Loop",
    description: "Tiling geometric shapes animating in a seamless loop.",
    group: "Backgrounds",
    data: {
      engine: "lottie",
      aspectRatio: "16:9",
      durationSeconds: 8,
      backgroundColor: "#0b0b0b",
      motionPrompt:
        "A full-frame geometric pattern backdrop that loops forever behind other content. Tile a grid of simple shapes (circles, triangles or diamonds — group-wrapped) in the shape color across the dark backdrop color, and animate the field with a traveling wave: each shape scales, rotates or fades on an offset tied to its grid position so a smooth ripple moves diagonally across the frame and wraps continuously. Use a repeater or a compact grid of groups to build the tiling while staying under the 50-layer budget — do not author every cell as its own layer. Keep the motion calm and hypnotic with ease-in-out. Because this is a standalone backdrop, fill the frame with the opaque backdrop color — this preset is allowed a full-frame background. Seamless loop — the wave's phase returns exactly to its start on the last frame so the eight-second cycle repeats with no seam or jump. Palette: one shape color over the dark backdrop color. Expose slots: shapeColor, backdropColor.",
    },
  },
]
