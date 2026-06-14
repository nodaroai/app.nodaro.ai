import { stagedLen, type StudioNavConfig } from "../studio-shell/types"
import type { CreatureStudioState } from "./use-creature-studio"
import type { CreatureStudioJobs } from "./use-creature-studio-jobs"
import { ReferencesPage } from "./pages/references-page"
import { AppearancePage } from "./pages/appearance-page"
import { AnglesPage } from "./pages/angles-page"
import { PosesPage } from "./pages/poses-page"
import { VariationsPage } from "./pages/variations-page"
import { MotionPage } from "./pages/motion-page"
import { VoicePage } from "./pages/voice-page"

type S = CreatureStudioState
type J = CreatureStudioJobs

/**
 * Creature studio navigation — the config-driven replacement for the old
 * hardcoded sidebar in `creature-studio-modal.tsx`. Purple accent (`#A78BFA`)
 * matches the creature node + MiniMap color. Reference photos are promoted out
 * of the Appearance tab into a first-class **References** page (Resources
 * group), mirroring the character/location/object studios' `Resources →
 * Identity → content` shape.
 *
 * Group/page parity with the old sidebar: Identity[appearance] ·
 * Composition[angles, poses] · Variants[variations] · Motion[motion] — plus the
 * new Resources[references] group at the top AND the new Character[**Voice**]
 * group (the "talking creature" stack, migration 220). Creature has NO Sheet
 * (matching today — the reference-sheet tab was never added to the creature
 * studio).
 *
 * Badge parity: Appearance + References show no count; every list-bucket
 * content page shows its asset-array `.length`; Voice shows a ✓ check once a
 * voice is set (mirrors the character voice nav entry).
 */
export const CREATURE_STUDIO_NAV: StudioNavConfig<S, J> = {
  accentActiveClassName: "text-[#A78BFA] bg-[#221a33] border-r-2 border-[#A78BFA]",
  groups: [
    { label: "Resources", pages: [
      { key: "references", label: "References", icon: "📷", Component: ReferencesPage },
    ] },
    { label: "Identity", pages: [
      { key: "appearance", label: "Appearance", icon: "🐾", Component: AppearancePage },
    ] },
    { label: "Composition", pages: [
      { key: "angles", label: "Angles", icon: "📐", Component: AnglesPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.angles) }) },
      { key: "poses", label: "Poses", icon: "🧍", Component: PosesPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.poses) }) },
    ] },
    { label: "Variants", pages: [
      { key: "variations", label: "Variations", icon: "✨", Component: VariationsPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.variations) }) },
    ] },
    { label: "Motion", pages: [
      { key: "motion", label: "Motion", icon: "🎬", Component: MotionPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.motionClips) }) },
    ] },
    { label: "Character", pages: [
      { key: "voice", label: "Voice", icon: "🎤", Component: VoicePage, badge: (s) => (s.stagedData?.voice ? { kind: "check" } : null) },
    ] },
  ],
}
