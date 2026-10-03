import { useCallback, useEffect, useState } from "react"
import { Navigate, useSearchParams } from "react-router-dom"
import { CopilotHomeSlot } from "@/components/dashboard/copilot-home-slot"
import { MoveWorkflowDialog } from "@/components/dashboard/move-workflow-dialog"
import { ProviderSetupCallout } from "@/components/dashboard/provider-setup-callout"
import { ContinueTab } from "@/components/dashboard/home/continue-tab"
import { ExploreTab } from "@/components/dashboard/home/explore-tab"
import { HomeHeader } from "@/components/dashboard/home/home-header"
import {
  HOME_PANEL_ID,
  MINIAPPS_KEY,
  STATISTICS_KEY,
  homeTabId,
  resolveHomeTab,
  type HomeTab,
} from "@/components/dashboard/home/home-tabs"
import type { UserFilterUser } from "@/components/user-filter"
import { useAllAdminUsersLite } from "@/ee/hooks/queries/use-admin-queries"
import { useAuth } from "@/hooks/use-auth"
import { useCreateWorkflow } from "@/hooks/use-create-workflow"
import type { MyWorkflow } from "@/hooks/queries/use-my-workflows-queries"
import { useT } from "@/lib/i18n"
import { surfaceNavHidden, surfaceTabs, surfaceTemplatesVisible } from "@/lib/surface-selectors"

const VIEW_ALL_STORAGE_KEY = "nodaro-admin-view-all-projects"
const NO_USERS: ReadonlyArray<UserFilterUser> = []

function readStoredViewAll(): boolean {
  try {
    return localStorage.getItem(VIEW_ALL_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

/**
 * The home screen: a greeting, the Continue / Explore tabs and the New Workflow
 * pill above one content panel. The tabs themselves, their sections and the
 * data they show live in components/dashboard/home/.
 */
export default function ProjectsPage() {
  const t = useT()
  const { isAdmin, user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const { createWorkflow, isCreating } = useCreateWorkflow()

  const displayName = user?.user_metadata?.full_name?.split(" ")[0]
    ?? user?.email?.split("@")[0]
    ?? ""
  // One whole sentence per variant: where the name sits, and what punctuation
  // or honorific surrounds it, depends on the language.
  const greeting = (() => {
    const hour = new Date().getHours()
    if (displayName) {
      if (hour < 12) return t("dash.goodMorningName", { name: displayName })
      if (hour < 18) return t("dash.goodAfternoonName", { name: displayName })
      return t("dash.goodEveningName", { name: displayName })
    }
    if (hour < 12) return t("dash.goodMorning")
    if (hour < 18) return t("dash.goodAfternoon")
    return t("dash.goodEvening")
  })()

  // The admin "All users" switch lives here, not in the Continue tab: the user
  // list it needs comes from an ee/ hook, and this page is the allowlisted place
  // core reaches it (tools/check-ee-imports.mjs).
  const [viewAll, setViewAll] = useState(() => isAdmin && readStoredViewAll())
  const showAll = isAdmin && viewAll
  const { data: adminUsers = NO_USERS } = useAllAdminUsersLite({ enabled: showAll })
  const handleViewAllChange = useCallback((checked: boolean) => {
    setViewAll(checked)
    try {
      localStorage.setItem(VIEW_ALL_STORAGE_KEY, String(checked))
    } catch {
      // storage blocked — the switch still applies for this visit
    }
  }, [])

  // Driven by the action menu on a workflow card.
  const [moveTarget, setMoveTarget] = useState<MyWorkflow | null>(null)

  // The URL is the single source of truth for which tab is open, NOT local
  // state seeded from it: going from ?tab=explore back to a plain /projects
  // (the sidebar's Projects item) does not remount this page, so seeded state
  // would keep the old tab open. The last tab is deliberately not restored from
  // storage for the same reason — Projects must always land on Continue.
  const exploreVisible = surfaceTemplatesVisible() || surfaceTabs(["tutorials"]).length > 0
  const resolution = resolveHomeTab(searchParams.get("tab"), {
    exploreVisible,
    // Same two gates as the sidebar's MiniApps entry.
    appsPageVisible: !surfaceNavHidden("apps") && surfaceTabs([MINIAPPS_KEY]).length > 0,
    statisticsVisible: surfaceTabs([STATISTICS_KEY]).length > 0,
  })
  const activeTab = resolution.tab
  const canonicalParam = resolution.canonicalParam

  // An old ?tab= link is rewritten in place (replace, not push), so the sidebar
  // highlights the right entry and the back button never walks through aliases.
  useEffect(() => {
    if (canonicalParam === undefined) return
    const next = new URLSearchParams(searchParams)
    if (canonicalParam === null) next.delete("tab")
    else next.set("tab", canonicalParam)
    setSearchParams(next, { replace: true })
  }, [canonicalParam, searchParams, setSearchParams])

  // Tab clicks replace rather than push: a tab is a view of one page, so the
  // back button should leave the page rather than walk the tabs.
  const selectTab = useCallback(
    (tab: HomeTab) => {
      const next = new URLSearchParams(searchParams)
      if (tab === "continue") next.delete("tab")
      else next.set("tab", tab)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  if (resolution.redirectTo) return <Navigate to={resolution.redirectTo} replace />

  return (
    <div className="@container flex h-full min-h-0 flex-col bg-[var(--home-bg)] ps-9 text-[var(--home-fg)] @max-[760px]:ps-5">
      {/* Community: "this install can't generate yet" until a key or the
          connection exists — dismissible, per user (#706). Renders null on cloud. */}
      <div className="pe-5 pt-4 empty:hidden">
        <ProviderSetupCallout userId={user?.id} />
      </div>

      <HomeHeader
        greeting={greeting}
        activeTab={activeTab}
        exploreVisible={exploreVisible}
        onSelectTab={selectTab}
        onNewWorkflow={createWorkflow}
        isCreating={isCreating}
      />

      <section
        id={HOME_PANEL_ID}
        role="tabpanel"
        aria-labelledby={homeTabId(activeTab)}
        className="home-panel min-h-0 flex-1 overflow-y-auto rounded-ss-[18px] border-s border-t border-[var(--home-line)] bg-[var(--home-panel)] px-9 pt-[26px] @max-[760px]:px-5 @max-[760px]:pt-[22px]"
      >
        {activeTab === "explore" ? (
          <ExploreTab />
        ) : (
          <ContinueTab
            isAdmin={isAdmin}
            viewAll={viewAll}
            onViewAllChange={handleViewAllChange}
            adminUsers={adminUsers}
            onCreateWorkflow={createWorkflow}
            isCreating={isCreating}
            onMoveWorkflow={setMoveTarget}
          />
        )}

        {/* The one control on this page that MAKES something, rather than
            listing what already exists. A fixed dock at the bottom of the
            viewport, so it goes LAST — and inside the scrolling panel, where
            its spacer keeps the dock off the final row of cards. Renders
            nothing without credits. */}
        <CopilotHomeSlot />
      </section>

      <MoveWorkflowDialog
        open={moveTarget !== null}
        onOpenChange={(open) => { if (!open) setMoveTarget(null) }}
        workflowId={moveTarget?.id ?? null}
        workflowName={moveTarget?.name ?? null}
        currentProjectId={moveTarget?.projectId ?? null}
      />
    </div>
  )
}
