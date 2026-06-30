import type React from "react"
import type { BlueprintProps } from "./types"
import { TitlecardReveal } from "./titlecard-reveal"
import { KineticTypeBeats } from "./kinetic-type-beats"
import { DatavizCountup } from "./dataviz-countup"
import { GridCardAssemble } from "./grid-card-assemble"
import { LogoAssembleLockup } from "./logo-assemble-lockup"
import { CtaMorphPress } from "./cta-morph-press"

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
  "cta-morph-press": CtaMorphPress,
  "dataviz-countup": DatavizCountup,
  "grid-card-assemble": GridCardAssemble,
  "kinetic-type-beats": KineticTypeBeats,
  "logo-assemble-lockup": LogoAssembleLockup,
  "titlecard-reveal": TitlecardReveal,
}
