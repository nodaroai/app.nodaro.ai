/**
 * Phase 1B.4 — shared animation constants. The keyframes are declared in
 * `globals.css` (Tailwind v4 keyframes live in the CSS layer); these exports
 * give component code a single source of truth for the duration + class name
 * so a future timing tweak only needs to land in one place.
 */
export const NODE_FADE_IN_DURATION_MS = 300
export const NODE_FADE_IN_CLASSNAME = "animate-fade-in-scale"
