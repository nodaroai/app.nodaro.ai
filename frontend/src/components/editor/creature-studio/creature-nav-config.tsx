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
import { BoardPage } from "./pages/board-page"

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
 * *planner* tab (the reference-sheet generator was never added to the creature
 * studio), but DOES surface a read-only **Board** page (Sheet group) that
 * displays named reference boards authored in studio.nodaro.ai.
 *
 * Badge parity: Appearance + References show no count; every list-bucket
 * content page shows its asset-array `.length`; Voice shows a ✓ check once a
 * voice is set (mirrors the character voice nav entry).
 */
export const CREATURE_STUDIO_NAV: StudioNavConfig<S, J> = {
  accentActiveClassName: "text-[#A78BFA] bg-[#221a33] border-e-2 border-[#A78BFA]",
  groups: [
    { label: "studioNav.resources", pages: [
      { key: "references", label: "studioNav.references", icon: "📷", Component: ReferencesPage },
    ] },
    { label: "studioNav.identity", pages: [
      { key: "appearance", label: "studioNav.appearance", icon: "🐾", Component: AppearancePage },
    ] },
    { label: "studioNav.composition", pages: [
      { key: "angles", label: "studioNav.angles", icon: "📐", Component: AnglesPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.angles) }) },
      { key: "poses", label: "studioNav.poses", icon: "🧍", Component: PosesPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.poses) }) },
    ] },
    { label: "studioNav.variants", pages: [
      { key: "variations", label: "studioNav.variations", icon: "✨", Component: VariationsPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.variations) }) },
    ] },
    { label: "studioNav.motion", pages: [
      { key: "motion", label: "studioNav.motion", icon: "🎬", Component: MotionPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.motionClips) }) },
    ] },
    { label: "studioNav.character", pages: [
      { key: "voice", label: "studioNav.voice", icon: "🎤", Component: VoicePage, badge: (s) => (s.stagedData?.voice ? { kind: "check" } : null) },
    ] },
    { label: "studioNav.sheet", pages: [
      { key: "board", label: "studioNav.board", icon: "🖼", Component: BoardPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.boards) }) },
    ] },
  ],
}
