import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom"
import { Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { hasAdmin, hasCredits, isCloud, isMultiUser, hasOrganizations } from "@/lib/edition"
import { surfaceNavHidden, surfaceBillingSelfServe } from "@/lib/surface-selectors"

// Error handling
import RouteErrorBoundary from "@/components/route-error-boundary"
import NotFound from "@/components/not-found"

// Layouts
import DashboardLayout from "@/layouts/dashboard-layout"

// Auth callback (eager — critical path)
import AuthCallback from "@/routes/auth-callback"
// External SSO landing (B6) — eager, like auth-callback: it runs the one-time
// token exchange before the user is authenticated, so it must not wait on a
// lazy chunk (and there is no route-level Suspense boundary here).
import SsoLandingPage from "@/routes/sso-landing"

// Dashboard pages (eager — /projects is the landing page)
import ProjectsPage from "@/app/(dashboard)/projects/page"
import ProjectPage from "@/routes/project-page"

// Lazy-loaded routes — not needed for initial /projects page load
const WorkflowEditorPage = lazy(() => import("@/routes/workflow-editor-page"))
const PipelinePage = lazy(() => import("@/routes/pipeline-page"))
const VideoDirectorPage = lazy(() => import("@/routes/video-director-page"))
const BillingPage = lazy(() => import("@/ee/app/(dashboard)/billing/page"))
const SettingsPage = lazy(() => import("@/app/(dashboard)/settings/page"))
const LibraryPage = lazy(() => import("@/app/(dashboard)/library/page"))
const LocationGalleryPage = lazy(() => import("@/components/library/location-gallery"))
const ExecutionsPage = lazy(() => import("@/app/(dashboard)/executions/page"))
const UsagePage = lazy(() => import("@/app/(dashboard)/usage/page"))
const ArchivedRunsPage = lazy(() => import("@/app/(dashboard)/archived-runs/page"))
const SharedWithMePage = lazy(() => import("@/app/(dashboard)/shared/page"))
const GalleryPage = lazy(() => import("@/app/gallery/page"))
const PricingPage = lazy(() => import("@/app/pricing/page"))
const CheckoutCompletePage = lazy(() => import("@/app/checkout-complete/page"))
const PresentPage = lazy(() => import("@/routes/present-page"))
const AppRunnerPage = lazy(() => import("@/routes/app-runner-page"))
const TutorialPage = lazy(() => import("@/routes/tutorial-page"))
const EmbedPage = lazy(() => import("@/routes/embed-page"))
const ApiSettingsPage = lazy(() => import("@/app/(dashboard)/settings/api/page"))
const DeveloperAppsPage = lazy(() => import("@/app/(dashboard)/settings/developer-apps/page"))
const DeveloperAppDetailPage = lazy(() => import("@/app/(dashboard)/settings/developer-apps/detail/page"))
const IntegrationsPage = lazy(() => import("@/app/(dashboard)/integrations/page"))
const AppsPage = lazy(() => import("@/app/(dashboard)/apps/page"))
const AppAnalyticsPage = lazy(() => import("@/app/(dashboard)/apps/analytics-page"))
const DeletedAppsPage = lazy(() => import("@/app/(dashboard)/apps/deleted/page"))
const TemplatesPage = lazy(() => import("@/app/(dashboard)/templates/page"))
const ExplorePage = lazy(() => import("@/ee/app/explore/page"))
const InvitationPage = lazy(() => import("@/ee/app/join/invitation-page"))
const JoinCodePage = lazy(() => import("@/ee/app/join/join-code-page"))
const NewOrgPage = lazy(() => import("@/ee/app/org/new-org-page"))
const WorkspaceHomePage = lazy(() => import("@/ee/app/workspace/workspace-home-page"))
const OrgOverviewPage = lazy(() => import("@/ee/app/org/org-overview-page"))
const OrgMembersPage = lazy(() => import("@/ee/app/org/org-members-page"))
const OrgWorkspacesPage = lazy(() => import("@/ee/app/org/org-workspaces-page"))
const OrgSettingsPage = lazy(() => import("@/ee/app/org/org-settings-page"))
const OrgAuditPage = lazy(() => import("@/ee/app/org/org-audit-page"))
const WorkspacePeoplePage = lazy(() => import("@/ee/app/workspace/workspace-people-page"))
const WorkspaceSettingsPage = lazy(() => import("@/ee/app/workspace/workspace-settings-page"))

// Auth pages (lazy — rarely revisited)
const LoginPage = lazy(() => import("@/app/(auth)/login/page"))
const SignupPage = lazy(() => import("@/app/(auth)/signup/page"))

// OAuth consent screen (lazy — public route, no chrome)
const OAuthAuthorizePage = lazy(() => import("@/app/oauth/authorize/page"))

// CLI login bridge (lazy — only used when `nodaro auth login` opens it)
const AuthCliPage = lazy(() => import("@/app/auth/cli/page"))

// MCP marketing landing page (lazy — public route, no chrome)
const McpPage = lazy(() => import("@/app/mcp/page"))

// Self-host install health screen (lazy — public route, non-cloud builds only)
const SetupPage = lazy(() => import("@/app/setup/page"))

// Admin layout + all admin pages (lazy — admin-only, most users never visit)
const AdminLayout = lazy(() => import("@/ee/layouts/admin-layout"))
const AdminDashboard = lazy(() => import("@/ee/app/(admin)/admin/page"))
const AdminUsers = lazy(() => import("@/ee/app/(admin)/admin/users/page"))
const AdminJobs = lazy(() => import("@/ee/app/(admin)/admin/jobs/page"))
const AdminUsage = lazy(() => import("@/ee/app/(admin)/admin/usage/page"))
const AdminAlerts = lazy(() => import("@/ee/app/(admin)/admin/alerts/page"))
const AdminModels = lazy(() => import("@/ee/app/(admin)/admin/models/page"))
const AdminReports = lazy(() => import("@/ee/app/(admin)/admin/reports/page"))
const AdminCommunityReports = lazy(() => import("@/ee/app/(admin)/admin/community-reports/page"))
const AdminPricingPage = lazy(() => import("@/ee/app/(admin)/admin/pricing/page"))
const AdminSettings = lazy(() => import("@/ee/app/(admin)/admin/settings/page"))
const AdminApps = lazy(() => import("@/ee/app/(admin)/admin/apps/page"))
const AdminCreditAudit = lazy(() => import("@/ee/app/(admin)/admin/credit-audit/page"))
const AdminCreditAnomalies = lazy(() => import("@/ee/app/(admin)/admin/credit-anomalies/page"))
const AdminFreeGrants = lazy(() => import("@/ee/app/(admin)/admin/free-grants/page"))
const AdminPickerGaps = lazy(() => import("@/ee/app/(admin)/admin/picker-gaps/page"))
const AdminCopilotGaps = lazy(() => import("@/ee/app/(admin)/admin/copilot-gaps/page"))
const AdminKieCredits = lazy(() => import("@/ee/app/(admin)/admin/kie-credits/page"))
const AdminSubscriptions = lazy(() => import("@/ee/app/(admin)/admin/subscriptions/page"))
const AdminLlmModels = lazy(() => import("@/ee/app/(admin)/admin/llm-models/page"))
const AdminNodeDefaults = lazy(() => import("@/ee/app/(admin)/admin/node-defaults/page"))
const AdminAvailability = lazy(() => import("@/ee/app/(admin)/admin/availability/page"))
const AdminTutorials = lazy(() => import("@/ee/app/(admin)/admin/tutorials/page"))
const AdminStuckPipelines = lazy(() => import("@/ee/app/(admin)/admin/stuck-pipelines/page"))
const AdminOrganizations = lazy(() => import("@/ee/app/(admin)/admin/organizations/page"))
const AdminTutorialCategories = lazy(() => import("@/ee/app/(admin)/admin/tutorial-categories/page"))
const AdminClientApps = lazy(() => import("@/ee/app/(admin)/admin/client-apps/page"))
const AdminAppReports = lazy(() => import("@/ee/app/(admin)/admin/app-reports/page"))
const AdminReview = lazy(() => import("@/ee/app/(admin)/admin/review/page"))

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={<div className="h-screen bg-background" />}
    >
      {children}
    </Suspense>
  )
}

// Admin route block — only included when EDITION grants admin (business or cloud).
// In community builds the spread is empty, the AdminLayout chunk is never loaded,
// and /admin URLs hit the NotFound handler at the bottom of the route tree.
const adminRoutes: RouteObject[] = hasAdmin() ? [
  {
    path: "/admin",
    element: <SuspenseWrapper><AdminLayout /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <SuspenseWrapper><AdminDashboard /></SuspenseWrapper> },
      { path: "users", element: <SuspenseWrapper><AdminUsers /></SuspenseWrapper> },
      { path: "jobs", element: <SuspenseWrapper><AdminJobs /></SuspenseWrapper> },
      { path: "usage", element: <SuspenseWrapper><AdminUsage /></SuspenseWrapper> },
      { path: "alerts", element: <SuspenseWrapper><AdminAlerts /></SuspenseWrapper> },
      { path: "models", element: <SuspenseWrapper><AdminModels /></SuspenseWrapper> },
      { path: "reports", element: <SuspenseWrapper><AdminReports /></SuspenseWrapper> },
      { path: "community-reports", element: <SuspenseWrapper><AdminCommunityReports /></SuspenseWrapper> },
      { path: "pricing", element: <SuspenseWrapper><AdminPricingPage /></SuspenseWrapper> },
      { path: "settings", element: <SuspenseWrapper><AdminSettings /></SuspenseWrapper> },
      { path: "miniapps", element: <SuspenseWrapper><AdminApps /></SuspenseWrapper> },
      { path: "minapps", element: <Navigate to="/admin/miniapps" replace /> },
      { path: "apps", element: <Navigate to="/admin/miniapps" replace /> },
      { path: "credit-audit", element: <SuspenseWrapper><AdminCreditAudit /></SuspenseWrapper> },
      { path: "credit-anomalies", element: <SuspenseWrapper><AdminCreditAnomalies /></SuspenseWrapper> },
      { path: "free-grants", element: <SuspenseWrapper><AdminFreeGrants /></SuspenseWrapper> },
      { path: "picker-gaps", element: <SuspenseWrapper><AdminPickerGaps /></SuspenseWrapper> },
      { path: "copilot-gaps", element: <SuspenseWrapper><AdminCopilotGaps /></SuspenseWrapper> },
      { path: "kie-credits", element: <SuspenseWrapper><AdminKieCredits /></SuspenseWrapper> },
      { path: "subscriptions", element: <SuspenseWrapper><AdminSubscriptions /></SuspenseWrapper> },
      { path: "llm-models", element: <SuspenseWrapper><AdminLlmModels /></SuspenseWrapper> },
      { path: "node-defaults", element: <SuspenseWrapper><AdminNodeDefaults /></SuspenseWrapper> },
      { path: "availability", element: <SuspenseWrapper><AdminAvailability /></SuspenseWrapper> },
      { path: "tutorial-categories", element: <SuspenseWrapper><AdminTutorialCategories /></SuspenseWrapper> },
      { path: "tutorials", element: <SuspenseWrapper><AdminTutorials /></SuspenseWrapper> },
      { path: "stuck-pipelines", element: <SuspenseWrapper><AdminStuckPipelines /></SuspenseWrapper> },
      // Only where organizations exist. The nav entry is gated the same way,
      // so the route and the link appear and disappear together — a visible
      // link to a 404 is worse than no link.
      ...(hasOrganizations()
        ? [{ path: "organizations", element: <SuspenseWrapper><AdminOrganizations /></SuspenseWrapper> }]
        : []),
      { path: "client-apps", element: <SuspenseWrapper><AdminClientApps /></SuspenseWrapper> },
      { path: "app-reports", element: <SuspenseWrapper><AdminAppReports /></SuspenseWrapper> },
      { path: "review", element: <SuspenseWrapper><AdminReview /></SuspenseWrapper> },
    ],
  },
] : []

// Community route block — only included when EDITION is multi-user (business or
// cloud). In community (single-user) builds the spread is empty and the
// ExplorePage chunk is never loaded.
const communityRoutes: RouteObject[] = isMultiUser() && !surfaceNavHidden("explore")
  ? [{ path: "/explore", element: <SuspenseWrapper><ExplorePage /></SuspenseWrapper> }]
  : []

// The two ways INTO an organization, registered next to /login rather than
// inside the dashboard layout — an invitee following a link is signed out,
// and a route behind the app chrome would bounce them to /login and lose the
// token they arrived with. Absent entirely on a build without the feature,
// so the URLs fall through to the NotFound handler rather than rendering a
// page that can only fail.
const orgPublicRoutes: RouteObject[] = hasOrganizations()
  ? [
      { path: "/join", element: <SuspenseWrapper><JoinCodePage /></SuspenseWrapper> },
      { path: "/join/:token", element: <SuspenseWrapper><InvitationPage /></SuspenseWrapper> },
    ]
  : []

// Self-host install health screen — never registered on cloud builds (the
// backend route is likewise gated behind !isCloud() in app.ts).
const setupRoutes: RouteObject[] = !isCloud()
  ? [{
      path: "/setup",
      element: <SuspenseWrapper><SetupPage /></SuspenseWrapper>,
      errorElement: <RouteErrorBoundary />,
    }]
  : []

export const router = createBrowserRouter([
  {
    path: "/",
    errorElement: <RouteErrorBoundary />,
    element: <Navigate to="/projects" replace />,
  },
  {
    path: "/auth/callback",
    element: <AuthCallback />,
  },
  {
    path: "/sso",
    element: <SsoLandingPage />,
  },
  ...orgPublicRoutes,
  {
    path: "/login",
    element: <SuspenseWrapper><LoginPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/signup",
    element: <SuspenseWrapper><SignupPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  // Public gallery — hidden when the deployment surface profile hides it (the
  // backend also skips registering /v1/gallery, so this is not just cosmetic).
  ...(surfaceNavHidden("gallery")
    ? []
    : [{
        path: "/gallery",
        element: <SuspenseWrapper><GalleryPage /></SuspenseWrapper>,
        errorElement: <RouteErrorBoundary />,
      }]),
  // Public, no-auth return page for embedded Stripe Checkout (new-tab flow).
  // Only reachable by returning from Stripe, which never happens without
  // billing — and the page talks about plans and credits. Also withheld when
  // the deployment turns self-serve purchase off (nothing is ever checked out).
  ...(hasCredits() && surfaceBillingSelfServe()
    ? [
        {
          path: "/checkout-complete",
          element: <SuspenseWrapper><CheckoutCompletePage /></SuspenseWrapper>,
          errorElement: <RouteErrorBoundary />,
        } as RouteObject,
      ]
    : []),
  {
    path: "/present/:shareToken",
    element: <SuspenseWrapper><PresentPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/app/:slug",
    element: <SuspenseWrapper><AppRunnerPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    // Guided view of a flow tutorial. Full-screen by design — it brings its own
    // app bar, so it sits outside DashboardLayout.
    path: "/tutorials/:slug",
    element: <SuspenseWrapper><TutorialPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/embed/:slug",
    element: <SuspenseWrapper><EmbedPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/oauth/authorize",
    element: <SuspenseWrapper><OAuthAuthorizePage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/auth/cli",
    element: <SuspenseWrapper><AuthCliPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/mcp",
    element: <SuspenseWrapper><McpPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    element: <DashboardLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: "/projects",
        element: <ProjectsPage />,
      },
      {
        path: "/projects/:id",
        element: <ProjectPage />,
      },
      {
        path: "/projects/:id/workflows/:workflowId",
        element: <SuspenseWrapper><WorkflowEditorPage /></SuspenseWrapper>,
      },
      {
        path: "/Pipeline",
        element: <SuspenseWrapper><PipelinePage /></SuspenseWrapper>,
      },
      {
        path: "/Pipeline/:pipelineId",
        element: <SuspenseWrapper><PipelinePage /></SuspenseWrapper>,
      },
      {
        path: "/video-director",
        element: <SuspenseWrapper><VideoDirectorPage /></SuspenseWrapper>,
      },
      // Self-serve billing. Withheld when the deployment turns self-serve
      // purchase off (a prepaid instance's users must not buy the platform's
      // credits by card); the sidebar hides its entry on the same switch.
      ...(surfaceBillingSelfServe()
        ? [{
            path: "/billing",
            element: <SuspenseWrapper><BillingPage /></SuspenseWrapper>,
          }]
        : []),
      {
        path: "/settings",
        element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper>,
      },
      {
        path: "/settings/api",
        element: <SuspenseWrapper><ApiSettingsPage /></SuspenseWrapper>,
      },
      {
        path: "/settings/developer-apps",
        element: <SuspenseWrapper><DeveloperAppsPage /></SuspenseWrapper>,
      },
      {
        path: "/settings/developer-apps/:id",
        element: <SuspenseWrapper><DeveloperAppDetailPage /></SuspenseWrapper>,
      },
      {
        path: "/executions",
        element: <SuspenseWrapper><ExecutionsPage /></SuspenseWrapper>,
      },
      {
        path: "/usage",
        element: <SuspenseWrapper><UsagePage /></SuspenseWrapper>,
      },
      {
        path: "/archived-runs",
        element: <SuspenseWrapper><ArchivedRunsPage /></SuspenseWrapper>,
      },
      {
        path: "/shared",
        element: <SuspenseWrapper><SharedWithMePage /></SuspenseWrapper>,
      },
      {
        path: "/my-files",
        element: <SuspenseWrapper><LibraryPage /></SuspenseWrapper>,
      },
      {
        path: "/library/locations",
        element: <SuspenseWrapper><LocationGalleryPage /></SuspenseWrapper>,
      },
      {
        path: "/integrations",
        element: <SuspenseWrapper><IntegrationsPage /></SuspenseWrapper>,
      },
      {
        path: "/apps",
        element: <SuspenseWrapper><AppsPage /></SuspenseWrapper>,
      },
      {
        path: "/apps/deleted",
        element: <SuspenseWrapper><DeletedAppsPage /></SuspenseWrapper>,
      },
      {
        path: "/apps/:appId/analytics",
        element: <SuspenseWrapper><AppAnalyticsPage /></SuspenseWrapper>,
      },
      {
        path: "/templates",
        element: <SuspenseWrapper><TemplatesPage /></SuspenseWrapper>,
      },
      ...communityRoutes,
      // Creating an organization needs a session and a sidebar, so unlike the
      // two /join routes it lives INSIDE the dashboard layout.
      ...(hasOrganizations()
        ? [
            { path: "/org/new", element: <SuspenseWrapper><NewOrgPage /></SuspenseWrapper> },
            { path: "/w/:id", element: <SuspenseWrapper><WorkspaceHomePage /></SuspenseWrapper> },
            { path: "/org/:slug", element: <SuspenseWrapper><OrgOverviewPage /></SuspenseWrapper> },
            { path: "/org/:slug/members", element: <SuspenseWrapper><OrgMembersPage /></SuspenseWrapper> },
            { path: "/org/:slug/workspaces", element: <SuspenseWrapper><OrgWorkspacesPage /></SuspenseWrapper> },
            { path: "/org/:slug/settings", element: <SuspenseWrapper><OrgSettingsPage /></SuspenseWrapper> },
            { path: "/org/:slug/audit", element: <SuspenseWrapper><OrgAuditPage /></SuspenseWrapper> },
            { path: "/w/:id/people", element: <SuspenseWrapper><WorkspacePeoplePage /></SuspenseWrapper> },
            { path: "/w/:id/settings", element: <SuspenseWrapper><WorkspaceSettingsPage /></SuspenseWrapper> },
          ]
        : []),
      // In-shell gallery. Gated on the SAME surface switch as the public /gallery
      // (NAV_ENTRY_ROUTES.gallery lists both) — a hidden-gallery deployment must
      // not still mount /_gallery against a backend that skips /v1/gallery.
      ...(surfaceNavHidden("gallery")
        ? []
        : [{
            path: "/_gallery",
            element: <SuspenseWrapper><GalleryPage /></SuspenseWrapper>,
          }]),
      ...(surfaceNavHidden("pricing")
        ? []
        : [{
            // In-app pricing. Lives inside DashboardLayout so it shows the sidebar
            // when used in-app, and (via the iframe check in DashboardLayout) renders
            // chromeless when studio.nodaro.ai embeds it. The session-handoff here
            // lets the embedded iframe authenticate.
            path: "/pricing",
            element: <SuspenseWrapper><PricingPage /></SuspenseWrapper>,
          }]),
      {
        // Back-compat: /_pricing was the interim in-shell path. Redirect any old
        // links/bookmarks to the clean /pricing.
        path: "/_pricing",
        element: <Navigate to="/pricing" replace />,
      },
    ],
  },
  ...adminRoutes,
  ...setupRoutes,
  {
    path: "*",
    element: <NotFound />,
  },
])
