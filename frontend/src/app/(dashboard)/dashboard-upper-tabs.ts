import type { DashboardTabKey } from "@/lib/surface-profile"

/** The dashboard's app-discovery strip (upper tabs in projects/page.tsx). */
export type UpperDashboardTab = "apps" | "miniapps" | "templates" | "tutorials" | "statistics"

export const UPPER_DASHBOARD_TABS: readonly UpperDashboardTab[] = [
  "apps",
  "miniapps",
  "templates",
  "tutorials",
  "statistics",
]

// Compile-time proof every upper tab is a surface-profile tab key, so
// surfaceTabs(UPPER_DASHBOARD_TABS) typechecks and a deployment profile can
// whitelist these keys in dashboard.tabs.
const _assertUpperAreTabKeys: readonly DashboardTabKey[] = UPPER_DASHBOARD_TABS
void _assertUpperAreTabKeys

/**
 * Which upper tab is active, given the tabs the surface profile leaves visible
 * (the surfaceTabs() result, in whitelist order) and the tab requested by the
 * URL. Mirrors effectiveWorkspaceTab in projects/page.tsx: a requested tab the
 * profile has hidden falls back to the first visible tab; when the profile
 * hides every upper tab, returns undefined and the caller renders no strip.
 */
export function resolveActiveUpperTab(
  visible: readonly UpperDashboardTab[],
  requested: string | null,
): UpperDashboardTab | undefined {
  if (requested && (visible as readonly string[]).includes(requested)) {
    return requested as UpperDashboardTab
  }
  return visible[0]
}
