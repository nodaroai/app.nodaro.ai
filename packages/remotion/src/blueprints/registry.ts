import type React from "react"
import type { BlueprintProps } from "./types"
import { ComparisonSplit } from "./comparison-split"
import { ConstellationHub } from "./constellation-hub"
import { CtaMorphPress } from "./cta-morph-press"
import { DatavizCountup } from "./dataviz-countup"
import { GridCardAssemble } from "./grid-card-assemble"
import { KineticTypeBeats } from "./kinetic-type-beats"
import { LogoAssembleLockup } from "./logo-assemble-lockup"
import { OverwhelmSurround } from "./overwhelm-surround"
import { SpatialPanStations } from "./spatial-pan-stations"
import { TickerTakeover } from "./ticker-takeover"
import { TitlecardReveal } from "./titlecard-reveal"
import { TypewriterReveal } from "./typewriter-reveal"

/**
 * Maps every known blueprint id to its Remotion component.
 *
 * SINGLE SOURCE OF TRUTH for the renderer — the drift guard in
 * `packages/remotion/src/blueprints/__tests__/registry.test.ts` asserts that
 * this record's keys exactly match the sorted list of BLUEPRINT_IDS from the
 * backend, and the backend's
 * `backend/src/services/shot-sequence/__tests__/blueprint-drift.test.ts`
 * asserts that BLUEPRINT_IDS matches the .tsx basenames in this directory.
 * Both must be kept in sync when a new blueprint is added.
 */
export const BLUEPRINT_REGISTRY: Record<string, React.FC<BlueprintProps>> = {
  "comparison-split": ComparisonSplit,
  "constellation-hub": ConstellationHub,
  "cta-morph-press": CtaMorphPress,
  "dataviz-countup": DatavizCountup,
  "grid-card-assemble": GridCardAssemble,
  "kinetic-type-beats": KineticTypeBeats,
  "logo-assemble-lockup": LogoAssembleLockup,
  "overwhelm-surround": OverwhelmSurround,
  "spatial-pan-stations": SpatialPanStations,
  "ticker-takeover": TickerTakeover,
  "titlecard-reveal": TitlecardReveal,
  "typewriter-reveal": TypewriterReveal,
}
