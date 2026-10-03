import { stagedLen, type StudioNavConfig } from "../studio-shell/types"
import type { LocationStudioState } from "./use-location-studio"
import type { LocationStudioJobs } from "./use-location-studio-jobs"
import { ReferencesPage } from "./pages/references-page"
import { AppearancePage } from "./pages/appearance-page"
import { TimeOfDayPage } from "./pages/time-of-day-page"
import { WeatherPage } from "./pages/weather-page"
import { SeasonsPage } from "./pages/seasons-page"
import { AnglesPage } from "./pages/angles-page"
import { LightingPage } from "./pages/lighting-page"
import { MotionPage } from "./pages/motion-page"
import { SheetPage } from "./pages/sheet-page"
import { BoardPage } from "./pages/board-page"

type S = LocationStudioState
type J = LocationStudioJobs

/**
 * Location studio navigation — the config-driven replacement for the old
 * hardcoded sidebar in `location-studio-modal.tsx`. Cyan accent (`#22d3ee`)
 * matches the location entity color. Reference photos are promoted out of the
 * Appearance tab into a first-class **References** page (Resources group),
 * mirroring the character studio's `Resources → Identity → content` shape.
 *
 * Badge parity with the old sidebar: Appearance + References show no count;
 * every list-bucket content page shows its asset-array `.length`.
 */
export const LOCATION_STUDIO_NAV: StudioNavConfig<S, J> = {
  accentActiveClassName: "text-[#22d3ee] bg-[#0e2730] border-e-2 border-[#22d3ee]",
  groups: [
    { label: "studioNav.resources", pages: [
      { key: "references", label: "studioNav.references", icon: "📷", Component: ReferencesPage },
    ] },
    { label: "studioNav.identity", pages: [
      { key: "appearance", label: "studioNav.exterior", icon: "🏞", Component: AppearancePage },
    ] },
    { label: "studioNav.environment", pages: [
      { key: "timeOfDay", label: "studioNav.timeOfDay", icon: "🌅", Component: TimeOfDayPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.timeOfDay) }) },
      { key: "weather", label: "studioNav.weather", icon: "🌧", Component: WeatherPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.weather) }) },
      { key: "seasons", label: "studioNav.seasons", icon: "🍁", Component: SeasonsPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.seasons) }) },
    ] },
    { label: "studioNav.composition", pages: [
      { key: "angles", label: "studioNav.angles", icon: "📐", Component: AnglesPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.angles) }) },
      { key: "lighting", label: "studioNav.lighting", icon: "💡", Component: LightingPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.lighting) }) },
    ] },
    { label: "studioNav.atmosphere", pages: [
      { key: "motion", label: "studioNav.motion", icon: "🎬", Component: MotionPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.atmosphereMotions) }) },
    ] },
    { label: "studioNav.sheet", pages: [
      { key: "sheet", label: "studioNav.sheet", icon: "📋", Component: SheetPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.sheets) }) },
      { key: "board", label: "studioNav.board", icon: "🖼", Component: BoardPage, badge: (s) => ({ kind: "count", value: stagedLen(s, (d) => d.boards) }) },
    ] },
  ],
}
