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
  accentActiveClassName: "text-[#22d3ee] bg-[#0e2730] border-r-2 border-[#22d3ee]",
  groups: [
    { label: "Resources", pages: [
      { key: "references", label: "References", icon: "📷", Component: ReferencesPage },
    ] },
    { label: "Identity", pages: [
      { key: "appearance", label: "Appearance", icon: "📦", Component: AppearancePage },
    ] },
    { label: "Composition", pages: [
      { key: "angles", label: "Angles", icon: "📐", Component: AnglesPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.angles) }) },
    ] },
    { label: "Variants", pages: [
      { key: "materials", label: "Materials", icon: "🧪", Component: MaterialsPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.materials) }) },
      { key: "variations", label: "Variations", icon: "✨", Component: VariationsPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.variations) }) },
    ] },
    { label: "Motion", pages: [
      { key: "motion", label: "Motion", icon: "🎬", Component: MotionPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.motionClips) }) },
    ] },
    { label: "Sheet", pages: [
      { key: "sheet", label: "Sheet", icon: "📋", Component: SheetPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.sheets) }) },
      { key: "board", label: "Board", icon: "🖼", Component: BoardPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.boards) }) },
    ] },
  ],
}
