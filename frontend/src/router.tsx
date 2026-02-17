import { createBrowserRouter, Navigate } from "react-router-dom"
import { lazy, Suspense } from "react"
import { Loader2 } from "lucide-react"

// Error handling
import RouteErrorBoundary from "@/components/route-error-boundary"
import NotFound from "@/components/not-found"

// Layouts
import DashboardLayout from "@/layouts/dashboard-layout"
import AdminLayout from "@/layouts/admin-layout"

// Auth callback (eager — critical path)
import AuthCallback from "@/routes/auth-callback"

// Dashboard pages (eager — instant tab switching)
import ProjectsPage from "@/app/(dashboard)/projects/page"
import ProjectPage from "@/routes/project-page"
import WorkflowEditorPage from "@/routes/workflow-editor-page"
import BillingPage from "@/app/(dashboard)/billing/page"
import SettingsPage from "@/app/(dashboard)/settings/page"
import LibraryPage from "@/app/(dashboard)/library/page"

// Admin pages (eager — instant tab switching)
import AdminDashboard from "@/app/(admin)/admin/page"
import AdminUsers from "@/app/(admin)/admin/users/page"
import AdminJobs from "@/app/(admin)/admin/jobs/page"
import AdminUsage from "@/app/(admin)/admin/usage/page"
import AdminAlerts from "@/app/(admin)/admin/alerts/page"
import AdminModels from "@/app/(admin)/admin/models/page"
import AdminReports from "@/app/(admin)/admin/reports/page"
import AdminPricingPage from "@/app/(admin)/admin/pricing/page"
import AdminSettings from "@/app/(admin)/admin/settings/page"

// All pages eager for instant navigation
import GalleryPage from "@/app/gallery/page"
import PricingPage from "@/app/pricing/page"

// Lazy-loaded routes (auth pages — rarely revisited)
const LoginPage = lazy(() => import("@/app/(auth)/login/page"))
const SignupPage = lazy(() => import("@/app/(auth)/signup/page"))

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
  },
  {
    path: "/signup",
    element: <SuspenseWrapper><SignupPage /></SuspenseWrapper>,
  },
  {
    path: "/gallery",
    element: <GalleryPage />,
  },
  {
    path: "/pricing",
    element: <PricingPage />,
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
        element: <WorkflowEditorPage />,
      },
      {
        path: "/billing",
        element: <BillingPage />,
      },
      {
        path: "/settings",
        element: <SettingsPage />,
      },
      {
        path: "/library",
        element: <LibraryPage />,
      },
    ],
  },
  {
    path: "/admin",
    element: <AdminLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <AdminDashboard />,
      },
      {
        path: "users",
        element: <AdminUsers />,
      },
      {
        path: "jobs",
        element: <AdminJobs />,
      },
      {
        path: "usage",
        element: <AdminUsage />,
      },
      {
        path: "alerts",
        element: <AdminAlerts />,
      },
      {
        path: "models",
        element: <AdminModels />,
      },
      {
        path: "reports",
        element: <AdminReports />,
      },
      {
        path: "pricing",
        element: <AdminPricingPage />,
      },
      {
        path: "settings",
        element: <AdminSettings />,
      },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
])
