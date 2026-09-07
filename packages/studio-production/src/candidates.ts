/**
 * The candidate-count ceiling — studio exposes 1…10 per Framing batch (a
 * fan-out is N parallel `generate-image` runs).
 *
 * A LEAF with no imports on purpose. The count is also a FORMAT-level fact (an
 * imported scene's `frame.count` is clamped to it, and the published schema
 * states it), and the two modules that used to declare it — the `CountSelector`
 * pill and the `useStartFraming` submit — both pull React, which the format
 * registry's renderers must not: they run under node in CI.
 */
export const MAX_CANDIDATES = 10
