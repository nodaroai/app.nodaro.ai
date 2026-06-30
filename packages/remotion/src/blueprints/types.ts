import type React from "react"

/**
 * Props every blueprint "shot-shape" component receives.
 *
 * The shot-sequence renderer wraps each blueprint reveal in its own
 * `<Sequence from={reveal.frame} durationInFrames={reveal.durationFrames}>`, so a
 * component reads its REVEAL-LOCAL frame via `useCurrentFrame()` (0 = its own
 * start) and canvas dimensions via `useVideoConfig()`. Note the prop is named
 * `durationInFrames` (the window length passed in); the plan/reveal field it is
 * mapped from is `durationFrames`.
 */
export interface BlueprintProps {
  /** Validated upstream against the backend per-blueprint Zod schema; a component
   *  casts this to its own `Params` interface. */
  readonly params: Record<string, unknown>
  /** The reveal's window length, in frames. */
  readonly durationInFrames: number
  /** Plan-level tokens so blueprints style consistently with the composition. */
  readonly brand: { readonly backgroundColor: string }
}

export type BlueprintComponent = React.FC<BlueprintProps>
