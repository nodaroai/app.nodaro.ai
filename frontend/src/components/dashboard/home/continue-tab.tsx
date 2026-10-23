import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FolderPlus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { FlagshipApps } from "@/components/dashboard/flagship-apps"
import { ImportJsonButton } from "@/components/dashboard/home/import-json-button"
import { McpRecentJobs } from "@/components/dashboard/mcp-recent-jobs"
import { MyWorkflowsView } from "@/components/dashboard/my-workflows-view"
import { ProjectsGridView } from "@/components/dashboard/projects-grid-view"
import { StudioWorkflowsView } from "@/components/dashboard/studio-workflows-view"
import type { UserFilterUser } from "@/components/user-filter"
import type { MyWorkflow } from "@/hooks/queries/use-my-workflows-queries"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { useT } from "@/lib/i18n"
import { useSharedHeaderActive } from "@/lib/shared-header"
import { surfaceTabs, surfacePlatformLinks } from "@/lib/surface-selectors"
import { SectionTitle, SegmentedControl, ThemeSwitch, type SegmentOption } from "./home-section"
import { NODARO_APPS_KEY } from "./home-tabs"
import { WelcomeOfferBannerSlot } from "./welcome-offer-banner-slot"

type WorkspaceTab = "workflows" | "projects" | "studio" | "mcp"

// `mcp`: the flows an MCP client (Claude, Cursor, ...) created in the
// auto-managed "mcp" project — split out so they stop crowding the personal list.
const WORKSPACE_TABS = ["workflows", "projects", "studio", "mcp"] as const satisfies readonly WorkspaceTab[]
const WORKSPACE_TAB_STORAGE_KEY = "nodaro-dashboard-workspace-tab"

function isWorkspaceTab(value: string | null): value is WorkspaceTab {
  return (WORKSPACE_TABS as readonly string[]).includes(value ?? "")
}

/** The URL wins over the last choice, so a deep link (?tab=projects) stays stable. */
function initialWorkspaceTab(): WorkspaceTab {
  if (typeof window === "undefined") return "workflows"
  const requested = new URLSearchParams(window.location.search).get("tab")
  if (isWorkspaceTab(requested)) return requested
  try {
    const stored = localStorage.getItem(WORKSPACE_TAB_STORAGE_KEY)
    if (isWorkspaceTab(stored) && stored !== "workflows") return stored
  } catch {
    // storage blocked — fall back to the flat workflow list
  }
  return "workflows"
}

interface ContinueTabProps {
  readonly isAdmin: boolean
  /** Admin "All users" switch — owned by the page, which fetches `adminUsers`. */
  readonly viewAll: boolean
  readonly onViewAllChange: (checked: boolean) => void
  readonly adminUsers: ReadonlyArray<UserFilterUser>
  readonly onCreateWorkflow: () => void
  readonly isCreating: boolean
  readonly onMoveWorkflow: (workflow: MyWorkflow) => void
}

/**
 * The Continue tab: the Nodaro apps band, then "Jump back in" — one segmented
 * filter over the four workspace lists, sharing a single search field.
 */
export function ContinueTab({
  isAdmin,
  viewAll,
  onViewAllChange,
  adminUsers,
  onCreateWorkflow,
  isCreating,
  onMoveWorkflow,
}: ContinueTabProps) {
  const t = useT()
  const navigate = useNavigate()
  const createProject = useProjectsStore((s) => s.createProject)
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>(initialWorkspaceTab)
  const [search, setSearch] = useState("")
  const showAll = isAdmin && viewAll

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_TAB_STORAGE_KEY, workspaceTab)
    } catch {
      // storage blocked — the choice just isn't remembered
    }
  }, [workspaceTab])

  // B1: a deployment surface profile can narrow the four lists. surfaceTabs
  // returns the code default unless a profile whitelists a subset; a whitelist
  // naming NO list falls back to all four (S4) so the section can never go
  // blank, and a stored/URL choice the profile has since hidden falls back to
  // the first visible list.
  const allowed = surfaceTabs(WORKSPACE_TABS)
  const narrowed = WORKSPACE_TABS.filter((tab) => allowed.includes(tab))
  const visibleTabs: readonly WorkspaceTab[] = narrowed.length ? narrowed : WORKSPACE_TABS
  const activeTab: WorkspaceTab = visibleTabs.includes(workspaceTab) ? workspaceTab : (visibleTabs[0] ?? "workflows")
  const labels: Record<WorkspaceTab, string> = {
    workflows: t("dash.myWorkflows"),
    projects: t("dash.myProjects"),
    studio: t("dash.studioWorkflows"),
    mcp: t("dash.mcpWorkflows"),
  }
  const options: readonly SegmentOption<WorkspaceTab>[] = visibleTabs.map((value) => ({ value, label: labels[value] }))

  // The shared site header's worlds row already links every Nodaro product, so
  // with it on the band is left out, like the sidebar's logo and credits.
  const sharedHeader = useSharedHeaderActive()
  const showApps = !sharedHeader && surfacePlatformLinks() && surfaceTabs([NODARO_APPS_KEY]).length > 0
  const searchPlaceholder =
    activeTab === "projects"
      ? showAll
        ? t("dash.searchProjectsUsers")
        : t("dash.searchProjectsPlaceholder")
      : t("dash.searchWorkflows")

  const handleCreateProject = async () => {
    const project = await createProject("Untitled Project")
    if (project) navigate(`/projects/${project.id}`)
  }

  return (
    <>
      {/* Welcome credits offer — above everything, until claimed (Cloud-only, self-hiding). */}
      <WelcomeOfferBannerSlot />
      {showApps && (
        <section>
          <SectionTitle title={t("home.section.nodaroApps")} trailing={<ThemeSwitch />} />
          {/* FlagshipApps pads its own grid; pull it back to the section edge. */}
          <div className="-mx-3 mt-2">
            <FlagshipApps />
          </div>
        </section>
      )}

      <section className={showApps ? "mt-6" : undefined}>
        {/* Import JSON rides in the heading row, not the controls row below it:
            it makes a workflow, and the controls under it filter the ones that
            already exist. The theme switch joins it here only when the apps
            band above is hidden and has not already taken it. */}
        <SectionTitle
          title={t("home.section.jumpBackIn")}
          trailing={
            <div className="flex items-center gap-4">
              {!showApps && <ThemeSwitch />}
              <ImportJsonButton />
            </div>
          }
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label={t("home.section.jumpBackIn")}
            options={options}
            value={activeTab}
            onChange={setWorkspaceTab}
          />
          <div className="flex flex-wrap items-center gap-3">
            {isAdmin && (
              <div className="flex items-center gap-2">
                <Switch id="view-all-projects" checked={viewAll} onCheckedChange={onViewAllChange} />
                <Label
                  htmlFor="view-all-projects"
                  className="cursor-pointer whitespace-nowrap text-xs text-[var(--home-muted)]"
                >
                  {t("exec.allUsers")}
                </Label>
              </div>
            )}
            {activeTab === "projects" && (
              <Button size="sm" variant="outline" className="h-8" onClick={handleCreateProject}>
                <FolderPlus className="me-1 h-4 w-4" aria-hidden />
                {t("dash.newProject")}
              </Button>
            )}
            <div className="relative w-[180px]">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--home-muted)]"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-8 rounded-lg ps-8 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="mb-8 mt-4">
          {activeTab === "workflows" && (
            <MyWorkflowsView
              onCreateWorkflow={onCreateWorkflow}
              onMoveWorkflow={onMoveWorkflow}
              isCreating={isCreating}
              search={search}
            />
          )}
          {activeTab === "studio" && <StudioWorkflowsView showAll={showAll} search={search} />}
          {activeTab === "projects" && <ProjectsGridView showAll={showAll} search={search} adminUsers={adminUsers} />}
          {activeTab === "mcp" && (
            <>
              <MyWorkflowsView
                scope="mcp"
                onCreateWorkflow={onCreateWorkflow}
                onMoveWorkflow={onMoveWorkflow}
                isCreating={isCreating}
                search={search}
              />
              <McpRecentJobs search={search} />
            </>
          )}
        </div>
      </section>
    </>
  )
}
