import "./globals.css"

// Backstop: prevent browser back from exiting the app on mobile.
// Push a /projects entry at the bottom of the history stack so back
// always has somewhere to go within the app.
if (window.history.length <= 2 && window.location.pathname !== "/projects" && !window.location.pathname.startsWith("/present/")) {
  window.history.replaceState(null, "", "/projects")
  window.history.pushState(null, "", window.location.pathname + window.location.search + window.location.hash)
}

import { StrictMode, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "sonner"
import { queryClient } from "@/lib/query-client"
import { router } from "./router"

const ReactQueryDevtools = lazy(() =>
  import("@tanstack/react-query-devtools").then((m) => ({
    default: m.ReactQueryDevtools,
  }))
)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
        <Toaster richColors position="bottom-right" />
      </ThemeProvider>
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  </StrictMode>,
)
