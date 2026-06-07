import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom"
import { Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { hasAdmin, isMultiUser } from "@/lib/edition"

// Error handling
import RouteErrorBoundary from "@/components/route-error-boundary"
import NotFound from "@/components/not-found"

// Layouts
import DashboardLayout from "@/layouts/dashboard-layout"

// Auth callback (eager — critical path)
import AuthCallback from "@/routes/auth-callback"

// Dashboard pages (eager — /projects is the landing page)
import ProjectsPage from "@/app/(dashboard)/projects/page"
import ProjectPage from "@/routes/project-page"

// Lazy-loaded routes — not needed for initial /projects page load
const WorkflowEditorPage = lazy(() => import("@/routes/workflow-editor-page"))
const PipelinePage = lazy(() => import("@/routes/pipeline-page"))
const BillingPage = lazy(() => import("@/ee/app/(dashboard)/billing/page"))
const SettingsPage = lazy(() => import("@/app/(dashboard)/settings/page"))
const LibraryPage = lazy(() => import("@/app/(dashboard)/library/page"))
const LocationGalleryPage = lazy(() => import("@/components/library/location-gallery"))
const ExecutionsPage = lazy(() => import("@/app/(dashboard)/executions/page"))
const ArchivedRunsPage = lazy(() => import("@/app/(dashboard)/archived-runs/page"))
const GalleryPage = lazy(() => import("@/app/gallery/page"))
const PricingPage = lazy(() => import("@/app/pricing/page"))
const PresentPage = lazy(() => import("@/routes/present-page"))
const AppRunnerPage = lazy(() => import("@/routes/app-runner-page"))
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

// Auth pages (lazy — rarely revisited)
const LoginPage = lazy(() => import("@/app/(auth)/login/page"))
const SignupPage = lazy(() => import("@/app/(auth)/signup/page"))

// OAuth consent screen (lazy — public route, no chrome)
const OAuthAuthorizePage = lazy(() => import("@/app/oauth/authorize/page"))

// CLI login bridge (lazy — only used when `nodaro auth login` opens it)
const AuthCliPage = lazy(() => import("@/app/auth/cli/page"))

// MCP marketing landing page (lazy — public route, no chrome)
const McpPage = lazy(() => import("@/app/mcp/page"))

// Admin layout + all admin pages (lazy — admin-only, most users never visit)
const AdminLayout = lazy(() => import("@/ee/layouts/admin-layout"))
const AdminDashboard = lazy(() => import("@/ee/app/(admin)/admin/page"))
const AdminUsers = lazy(() => import("@/ee/app/(admin)/admin/users/page"))
const AdminJobs = lazy(() => import("@/ee/app/(admin)/admin/jobs/page"))
const AdminUsage = lazy(() => import("@/ee/app/(admin)/admin/usage/page"))
const AdminAlerts = lazy(() => import("@/ee/app/(admin)/admin/alerts/page"))
const AdminModels = lazy(() => import("@/ee/app/(admin)/admin/models/page"))
const AdminReports = lazy(() => import("@/ee/app/(admin)/admin/reports/page"))
const AdminPricingPage = lazy(() => import("@/ee/app/(admin)/admin/pricing/page"))
const AdminSettings = lazy(() => import("@/ee/app/(admin)/admin/settings/page"))
const AdminApps = lazy(() => import("@/ee/app/(admin)/admin/apps/page"))
const AdminCreditAudit = lazy(() => import("@/ee/app/(admin)/admin/credit-audit/page"))
const AdminCreditAnomalies = lazy(() => import("@/ee/app/(admin)/admin/credit-anomalies/page"))
const AdminKieCredits = lazy(() => import("@/ee/app/(admin)/admin/kie-credits/page"))
const AdminSubscriptions = lazy(() => import("@/ee/app/(admin)/admin/subscriptions/page"))
const AdminLlmModels = lazy(() => import("@/ee/app/(admin)/admin/llm-models/page"))
const AdminNodeDefaults = lazy(() => import("@/ee/app/(admin)/admin/node-defaults/page"))
const AdminTutorials = lazy(() => import("@/ee/app/(admin)/admin/tutorials/page"))
const AdminStuckPipelines = lazy(() => import("@/ee/app/(admin)/admin/stuck-pipelines/page"))
const AdminTutorialCategories = lazy(() => import("@/ee/app/(admin)/admin/tutorial-categories/page"))

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
      { path: "pricing", element: <SuspenseWrapper><AdminPricingPage /></SuspenseWrapper> },
      { path: "settings", element: <SuspenseWrapper><AdminSettings /></SuspenseWrapper> },
      { path: "apps", element: <SuspenseWrapper><AdminApps /></SuspenseWrapper> },
      { path: "credit-audit", element: <SuspenseWrapper><AdminCreditAudit /></SuspenseWrapper> },
      { path: "credit-anomalies", element: <SuspenseWrapper><AdminCreditAnomalies /></SuspenseWrapper> },
      { path: "kie-credits", element: <SuspenseWrapper><AdminKieCredits /></SuspenseWrapper> },
      { path: "subscriptions", element: <SuspenseWrapper><AdminSubscriptions /></SuspenseWrapper> },
      { path: "llm-models", element: <SuspenseWrapper><AdminLlmModels /></SuspenseWrapper> },
      { path: "node-defaults", element: <SuspenseWrapper><AdminNodeDefaults /></SuspenseWrapper> },
      { path: "tutorial-categories", element: <SuspenseWrapper><AdminTutorialCategories /></SuspenseWrapper> },
      { path: "tutorials", element: <SuspenseWrapper><AdminTutorials /></SuspenseWrapper> },
      { path: "stuck-pipelines", element: <SuspenseWrapper><AdminStuckPipelines /></SuspenseWrapper> },
    ],
  },
] : []

// Community route block — only included when EDITION is multi-user (business or
// cloud). In community (single-user) builds the spread is empty and the
// ExplorePage chunk is never loaded.
const communityRoutes: RouteObject[] = isMultiUser()
  ? [{ path: "/explore", element: <SuspenseWrapper><ExplorePage /></SuspenseWrapper> }]
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
    path: "/login",
    element: <SuspenseWrapper><LoginPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/signup",
    element: <SuspenseWrapper><SignupPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/gallery",
    element: <SuspenseWrapper><GalleryPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/pricing",
    element: <SuspenseWrapper><PricingPage /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
  },
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
        path: "/billing",
        element: <SuspenseWrapper><BillingPage /></SuspenseWrapper>,
      },
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
        path: "/archived-runs",
        element: <SuspenseWrapper><ArchivedRunsPage /></SuspenseWrapper>,
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
      {
        path: "/_gallery",
        element: <SuspenseWrapper><GalleryPage /></SuspenseWrapper>,
      },
      {
        path: "/_pricing",
        element: <SuspenseWrapper><PricingPage /></SuspenseWrapper>,
      },
    ],
  },
  ...adminRoutes,
  {
    path: "*",
    element: <NotFound />,
  },
])
