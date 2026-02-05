"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"

export const SIDEBAR_COLLAPSED_WIDTH = 56 // w-14 = 3.5rem = 56px
export const SIDEBAR_EXPANDED_WIDTH = 224 // w-56 = 14rem = 224px

interface SidebarContextValue {
  isCollapsed: boolean
  sidebarWidth: number
  setCollapsed: (collapsed: boolean) => void
  toggleCollapsed: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

interface SidebarProviderProps {
  readonly children: ReactNode
  readonly defaultCollapsed?: boolean
}

export function SidebarProvider({ children, defaultCollapsed = false }: SidebarProviderProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  const setCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsed(collapsed)
  }, [])

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => !prev)
  }, [])

  const sidebarWidth = isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH

  return (
    <SidebarContext.Provider value={{ isCollapsed, sidebarWidth, setCollapsed, toggleCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    // Return default values if not in a provider (e.g., non-editor pages)
    return {
      isCollapsed: true,
      sidebarWidth: SIDEBAR_COLLAPSED_WIDTH,
      setCollapsed: () => {},
      toggleCollapsed: () => {},
    }
  }
  return context
}
