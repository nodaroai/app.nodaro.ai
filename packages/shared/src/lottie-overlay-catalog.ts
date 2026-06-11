/**
 * Built-in Lottie Overlay catalog — single source of truth.
 *
 * The Lottie Overlay node ships a curated set of 12 animations the overlay LLM
 * can pick from. They were originally served from the third-party lottie.host
 * CDN, which went dead (origin returns 403) and broke every catalog-based
 * overlay render in production. The replacements were authored with our own
 * Lottie engine, baked (slots resolved, no `sid` refs), and are now self-hosted
 * on the Nodaro CDN at `https://cdn.nodaro.ai/lottie-catalog/<slug>.json`.
 *
 * This module is the ONE place the catalog lives:
 *   - `LOTTIE_OVERLAY_CATALOG` feeds the overlay system prompt (the LLM's menu).
 *   - `LEGACY_LOTTIE_HOST_REMAP` + `resolveLottieOverlaySrc` heal saved overlay
 *     plans at render time — a plan authored before the cut-over still points at
 *     a dead lottie.host URL, so the renderer rewrites it to its self-hosted
 *     replacement before fetching.
 */

export interface LottieOverlayCatalogEntry {
  /** Stable system key — the R2 object is `lottie-catalog/<slug>.json`. */
  readonly slug: string
  /** Display name — mirrors the original prompt's catalog labels. */
  readonly name: string
  /** Catalog group (drives the grouped layout in the system prompt). */
  readonly group:
    | "Celebration"
    | "Social / Reactions"
    | "UI / Indicators"
    | "Ambient / Decorative"
  /** One placement-intent line for the overlay LLM. */
  readonly description: string
  /** Public CDN URL: `https://cdn.nodaro.ai/lottie-catalog/<slug>.json`. */
  readonly url: string
  /** Whether the animation is continuous (loop) or a one-shot effect. */
  readonly loop: boolean
}

const CDN_BASE = "https://cdn.nodaro.ai/lottie-catalog"

export const LOTTIE_OVERLAY_CATALOG: readonly LottieOverlayCatalogEntry[] = [
  // ── Celebration ────────────────────────────────────────────────────────────
  {
    slug: "confetti-burst",
    name: "Confetti burst",
    group: "Celebration",
    description: "Multicolor confetti shower — large coverage at a celebratory peak; one-shot.",
    url: `${CDN_BASE}/confetti-burst.json`,
    loop: false,
  },
  {
    slug: "fireworks",
    name: "Fireworks",
    group: "Celebration",
    description: "Bursting fireworks against the sky — big-moment payoff over the upper frame; one-shot.",
    url: `${CDN_BASE}/fireworks.json`,
    loop: false,
  },
  {
    slug: "party-popper",
    name: "Party popper",
    group: "Celebration",
    description: "Party popper streamers from a corner — a quick celebratory accent; one-shot.",
    url: `${CDN_BASE}/party-popper.json`,
    loop: false,
  },
  {
    slug: "stars-sparkle",
    name: "Stars sparkle",
    group: "Celebration",
    description: "Twinkling stars/sparkles — small accent over a highlight; loops.",
    url: `${CDN_BASE}/stars-sparkle.json`,
    loop: true,
  },
  // ── Social / Reactions ──────────────────────────────────────────────────────
  {
    slug: "heart-pulse",
    name: "Heart pulse",
    group: "Social / Reactions",
    description: "Pulsing heart reaction — medium size at a corner or edge; loops.",
    url: `${CDN_BASE}/heart-pulse.json`,
    loop: true,
  },
  {
    slug: "thumbs-up",
    name: "Thumbs up",
    group: "Social / Reactions",
    description: "Thumbs-up approval reaction — medium size, pops in once; one-shot.",
    url: `${CDN_BASE}/thumbs-up.json`,
    loop: false,
  },
  {
    slug: "fire-flame",
    name: "Fire emoji",
    group: "Social / Reactions",
    description: "Flickering flame reaction (“this is fire”) — small size at an edge; loops.",
    url: `${CDN_BASE}/fire-flame.json`,
    loop: true,
  },
  // ── UI / Indicators ─────────────────────────────────────────────────────────
  {
    slug: "loading-spinner",
    name: "Loading spinner",
    group: "UI / Indicators",
    description: "Circular loading spinner — small, centered, signals progress; loops.",
    url: `${CDN_BASE}/loading-spinner.json`,
    loop: true,
  },
  {
    slug: "checkmark-success",
    name: "Checkmark success",
    group: "UI / Indicators",
    description: "Animated success checkmark — small, marks a completed/correct moment; one-shot.",
    url: `${CDN_BASE}/checkmark-success.json`,
    loop: false,
  },
  {
    slug: "arrow-pointer",
    name: "Arrow pointer",
    group: "UI / Indicators",
    description: "Animated arrow drawing attention to a spot — small, timed to a key area; loops.",
    url: `${CDN_BASE}/arrow-pointer.json`,
    loop: true,
  },
  // ── Ambient / Decorative ────────────────────────────────────────────────────
  {
    slug: "floating-particles",
    name: "Floating particles",
    group: "Ambient / Decorative",
    description: "Soft drifting particles — large coverage, low opacity, full-duration ambience; loops.",
    url: `${CDN_BASE}/floating-particles.json`,
    loop: true,
  },
  {
    slug: "glowing-ring",
    name: "Glowing ring",
    group: "Ambient / Decorative",
    description: "Pulsing glowing ring/halo — decorative accent around a focal point; loops.",
    url: `${CDN_BASE}/glowing-ring.json`,
    loop: true,
  },
] as const

/**
 * Dead lottie.host URLs (origin returns 403) → their replacement catalog URLs.
 * Heals saved plans at render time. The keys are copied EXACTLY from the
 * original `lottie-overlay-system.ts` prompt — they are the literal `src`
 * strings the overlay LLM emitted before the cut-over.
 */
export const LEGACY_LOTTIE_HOST_REMAP: Readonly<Record<string, string>> = {
  // Celebration
  "https://lottie.host/d7313e87-e4c9-4e0d-8e03-c3a59e87d8fb/TjHnrCGBjI.json": `${CDN_BASE}/confetti-burst.json`,
  "https://lottie.host/d5cad0dd-4e93-4bbe-b023-e94a04bc1581/JHEZMrqfMk.json": `${CDN_BASE}/fireworks.json`,
  "https://lottie.host/0060c9cd-75da-42d5-af7c-1a191fa8a8fd/c1xHMRnGTO.json": `${CDN_BASE}/party-popper.json`,
  "https://lottie.host/c04a2758-a1d9-40a9-b81f-6f3e4e13a88c/xKCYDU2w0O.json": `${CDN_BASE}/stars-sparkle.json`,
  // Social / Reactions
  "https://lottie.host/44c9e8d1-856c-4641-bfbe-d0e2a5c9850e/GIBsMSIkkq.json": `${CDN_BASE}/heart-pulse.json`,
  "https://lottie.host/9a611d56-1f35-4f51-9fa4-6a4daa6b8714/EH71MjHKPD.json": `${CDN_BASE}/thumbs-up.json`,
  "https://lottie.host/66db1de9-c1a8-4d0b-bb03-47a8932a8a86/q5JBGQ8fxu.json": `${CDN_BASE}/fire-flame.json`,
  // UI / Indicators
  "https://lottie.host/b03d748c-3b4a-4c07-a10c-e9eb3c967349/eMVAVEnb5x.json": `${CDN_BASE}/loading-spinner.json`,
  "https://lottie.host/3ffaab4a-58b0-4a72-9f1c-5eaa484d8c88/g27v7IPaJc.json": `${CDN_BASE}/checkmark-success.json`,
  "https://lottie.host/6f831c6e-693a-4d1d-90a0-d7e2b3f00e68/PFj0MwSPrj.json": `${CDN_BASE}/arrow-pointer.json`,
  // Ambient / Decorative
  "https://lottie.host/9c8e1aef-f8e5-4ce8-bc80-1647ffb0724d/mNDClfKJVB.json": `${CDN_BASE}/floating-particles.json`,
  "https://lottie.host/b5d3e7e7-40bc-44fa-9a53-78b98ad66e80/pQVdNsVDmQ.json": `${CDN_BASE}/glowing-ring.json`,
}

/**
 * Resolve an overlay `src` through the legacy remap: a dead lottie.host URL is
 * rewritten to its self-hosted replacement; everything else (already-migrated
 * catalog URLs, user-provided assets) passes through unchanged.
 */
export function resolveLottieOverlaySrc(src: string): string {
  return LEGACY_LOTTIE_HOST_REMAP[src] ?? src
}
