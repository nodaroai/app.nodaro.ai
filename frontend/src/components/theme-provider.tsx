"use client"

import { useEffect } from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import type { ReactNode } from "react"

interface ThemeProviderProps {
  readonly children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  useEffect(() => {
    // Suppress known benign Supabase auth AbortError from Navigator Lock timeouts.
    // This is an internal Supabase issue where locks.ts calls abort() without a reason
    // during auth session synchronization across tabs.
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const error = event.reason
      if (
        error instanceof DOMException &&
        error.name === "AbortError" &&
        error.message.includes("signal is aborted")
      ) {
        event.preventDefault()
      }
    }
    window.addEventListener("unhandledrejection", handleUnhandledRejection)
    return () => window.removeEventListener("unhandledrejection", handleUnhandledRejection)
  }, [])

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
