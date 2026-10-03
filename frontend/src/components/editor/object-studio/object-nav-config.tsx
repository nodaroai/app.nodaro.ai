import { stagedLen, type StudioNavConfig } from "../studio-shell/types"
import type { ObjectStudioState } from "./use-object-studio"
import type { ObjectStudioJobs } from "./use-object-studio-jobs"
import { ReferencesPage } from "./pages/references-page"
import { AppearancePage } from "./pages/appearance-page"
import { AnglesPage } from "./pages/angles-page"
import { MaterialsPage } from "./pages/materials-page"
import { VariationsPage } from "./pages/variations-page"
import { MotionPage } from "./pages/motion-page"
import { SheetPage } from "./pages/sheet-page"
import { BoardPage } from "./pages/board-page"

type S = ObjectStudioState
type J = ObjectStudioJobs

/**
 * Object studio navigation — the config-driven replacement for the old
 * hardcoded sidebar in `object-studio-modal.tsx`. Cyan accent (`#22d3ee`)
 * matches the object entity color. Reference photos are promoted out of the
 * Appearance tab into a first-class **References** page (Resources group),
 * mirroring the character/location studios' `Resources → Identity → content`
 * shape.
 *
 * Group/page parity with the old sidebar: Identity[appearance] ·
 * Composition[angles] · Variants[materials, variations] · Motion[motion] ·
 * Sheet[sheet] — plus the new Resources[references] group at the top.
 *
 * Badge parity with the old sidebar: Appearance + References show no count;
 * every list-bucket content page shows its asset-array `.length`.
 */
export const OBJECT_STUDIO_NAV: StudioNavConfig<S, J> = {
  accentActiveClassName: "text-[#22d3ee] bg-[#0e2730] border-e-2 border-[#22d3ee]",
  groups: [
    { label: "studioNav.resources", pages: [
      { key: "references", label: "studioNav.references", icon: "📷", Component: ReferencesPage },
    ] },
    { label: "studioNav.identity", pages: [
      { key: "appearance", label: "studioNav.exterior", icon: "📦", Component: AppearancePage },
    ] },
    { label: "studioNav.composition", pages: [
      { key: "angles", label: "studioNav.angles", icon: "📐", Component: AnglesPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.angles) }) },
    ] },
    { label: "studioNav.variants", pages: [
      { key: "materials", label: "studioNav.materials", icon: "🧪", Component: MaterialsPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.materials) }) },
      { key: "variations", label: "studioNav.variations", icon: "✨", Component: VariationsPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.variations) }) },
    ] },
    { label: "studioNav.motion", pages: [
      { key: "motion", label: "studioNav.motion", icon: "🎬", Component: MotionPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.motionClips) }) },
    ] },
    { label: "studioNav.sheet", pages: [
      { key: "sheet", label: "studioNav.sheet", icon: "📋", Component: SheetPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.sheets) }) },
      { key: "board", label: "studioNav.board", icon: "🖼", Component: BoardPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.boards) }) },
    ] },
  ],
}
