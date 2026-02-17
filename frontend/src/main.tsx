import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "./globals.css"

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "sonner"
import { router } from "./router"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  </StrictMode>,
)
