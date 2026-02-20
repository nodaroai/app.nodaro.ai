import { createBrowserRouter, Navigate } from "react-router-dom"
import { lazy, Suspense } from "react"
import { Loader2 } from "lucide-react"

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
const BillingPage = lazy(() => import("@/app/(dashboard)/billing/page"))
const SettingsPage = lazy(() => import("@/app/(dashboard)/settings/page"))
const LibraryPage = lazy(() => import("@/app/(dashboard)/library/page"))
const GalleryPage = lazy(() => import("@/app/gallery/page"))
const PricingPage = lazy(() => import("@/app/pricing/page"))

// Auth pages (lazy — rarely revisited)
const LoginPage = lazy(() => import("@/app/(auth)/login/page"))
const SignupPage = lazy(() => import("@/app/(auth)/signup/page"))

// Admin layout + all admin pages (lazy — admin-only, most users never visit)
const AdminLayout = lazy(() => import("@/layouts/admin-layout"))
const AdminDashboard = lazy(() => import("@/app/(admin)/admin/page"))
const AdminUsers = lazy(() => import("@/app/(admin)/admin/users/page"))
const AdminJobs = lazy(() => import("@/app/(admin)/admin/jobs/page"))
const AdminUsage = lazy(() => import("@/app/(admin)/admin/usage/page"))
const AdminAlerts = lazy(() => import("@/app/(admin)/admin/alerts/page"))
const AdminModels = lazy(() => import("@/app/(admin)/admin/models/page"))
const AdminReports = lazy(() => import("@/app/(admin)/admin/reports/page"))
const AdminPricingPage = lazy(() => import("@/app/(admin)/admin/pricing/page"))
const AdminSettings = lazy(() => import("@/app/(admin)/admin/settings/page"))

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      {children}
    </Suspense>
  )
}

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
        path: "/billing",
        element: <SuspenseWrapper><BillingPage /></SuspenseWrapper>,
      },
      {
        path: "/settings",
        element: <SuspenseWrapper><SettingsPage /></SuspenseWrapper>,
      },
      {
        path: "/library",
        element: <SuspenseWrapper><LibraryPage /></SuspenseWrapper>,
      },
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
  {
    path: "/admin",
    element: <SuspenseWrapper><AdminLayout /></SuspenseWrapper>,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <SuspenseWrapper><AdminDashboard /></SuspenseWrapper>,
      },
      {
        path: "users",
        element: <SuspenseWrapper><AdminUsers /></SuspenseWrapper>,
      },
      {
        path: "jobs",
        element: <SuspenseWrapper><AdminJobs /></SuspenseWrapper>,
      },
      {
        path: "usage",
        element: <SuspenseWrapper><AdminUsage /></SuspenseWrapper>,
      },
      {
        path: "alerts",
        element: <SuspenseWrapper><AdminAlerts /></SuspenseWrapper>,
      },
      {
        path: "models",
        element: <SuspenseWrapper><AdminModels /></SuspenseWrapper>,
      },
      {
        path: "reports",
        element: <SuspenseWrapper><AdminReports /></SuspenseWrapper>,
      },
      {
        path: "pricing",
        element: <SuspenseWrapper><AdminPricingPage /></SuspenseWrapper>,
      },
      {
        path: "settings",
        element: <SuspenseWrapper><AdminSettings /></SuspenseWrapper>,
      },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
])
