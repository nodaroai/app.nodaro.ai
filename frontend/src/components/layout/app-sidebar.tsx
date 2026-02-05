"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  FolderOpen,
  Settings,
  Shield,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { isFeatureEnabled } from "@/lib/edition"

const STORAGE_KEY = "scenenode-sidebar-collapsed"

interface NavItem {
  readonly href: string
  readonly label: string
  readonly icon: React.ComponentType<{ className?: string }>
  readonly adminOnly?: boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin", icon: Shield, adminOnly: true },
]

interface AppSidebarProps {
  readonly forceCollapsed?: boolean
  readonly onMobileClose?: () => void
  readonly isMobileOpen?: boolean
}

export function AppSidebar({
  forceCollapsed = false,
  onMobileClose,
  isMobileOpen = false,
}: AppSidebarProps) {
  const pathname = usePathname()
  const { user, isAdmin, signOut } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      setCollapsed(stored === "true")
    }
    setMounted(true)
  }, [])

  // Apply forceCollapsed when it changes (e.g., entering editor)
  useEffect(() => {
    if (forceCollapsed && !collapsed) {
      setCollapsed(true)
      localStorage.setItem(STORAGE_KEY, "true")
    }
  }, [forceCollapsed, collapsed])

  const toggleCollapsed = () => {
    const newValue = !collapsed
    setCollapsed(newValue)
    localStorage.setItem(STORAGE_KEY, String(newValue))
  }

  const handleNavClick = () => {
    onMobileClose?.()
  }

  // Don't render with wrong state during hydration
  if (!mounted) {
    return null
  }

  const effectiveCollapsed = forceCollapsed || collapsed

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-zinc-950 transition-all duration-300 ease-in-out md:static",
          effectiveCollapsed ? "w-14" : "w-56",
          isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-14 px-3 border-b border-zinc-800">
          <Link
            href="/projects"
            onClick={handleNavClick}
            className={cn(
              "flex items-center gap-2 font-bold text-[#ff0073] transition-all duration-300",
              effectiveCollapsed ? "justify-center w-full" : "",
            )}
          >
            {effectiveCollapsed ? (
              <span className="text-lg">S</span>
            ) : (
              <span className="text-lg">SceneNode</span>
            )}
          </Link>
          {/* Mobile close button */}
          {!effectiveCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 md:hidden text-zinc-400 hover:text-white hover:bg-zinc-800"
              onClick={onMobileClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            // Skip admin item if not admin or feature not enabled
            if (item.adminOnly && (!isFeatureEnabled("adminPanel") || !isAdmin)) {
              return null
            }

            const isActive = item.href === "/admin"
              ? pathname.startsWith("/admin")
              : pathname === item.href || pathname.startsWith(item.href + "/")

            const linkContent = (
              <Link
                href={item.href}
                onClick={handleNavClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200",
                  effectiveCollapsed ? "justify-center px-0" : "",
                  isActive
                    ? "bg-[#ff0073]/10 text-[#ff0073] border-l-2 border-[#ff0073] -ml-0.5 pl-[10px]"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white",
                )}
              >
                <item.icon className={cn("h-5 w-5 flex-shrink-0", isActive && "text-[#ff0073]")} />
                {!effectiveCollapsed && <span>{item.label}</span>}
              </Link>
            )

            if (effectiveCollapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right" className="bg-zinc-800 text-white border-zinc-700">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              )
            }

            return <div key={item.href}>{linkContent}</div>
          })}
        </nav>

        {/* Bottom section */}
        <div className="px-2 py-3 border-t border-zinc-800 space-y-2">
          {/* Collapse toggle */}
          <div className="hidden md:block">
            {effectiveCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-9 p-0 text-zinc-400 hover:text-white hover:bg-zinc-800"
                    onClick={toggleCollapsed}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-zinc-800 text-white border-zinc-700">
                  Expand sidebar
                </TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-9 justify-start gap-3 px-3 text-zinc-400 hover:text-white hover:bg-zinc-800"
                onClick={toggleCollapsed}
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="text-sm">Collapse</span>
              </Button>
            )}
          </div>

          {/* User info */}
          {user && (
            <div
              className={cn(
                "flex items-center gap-2",
                effectiveCollapsed ? "justify-center" : "justify-between",
              )}
            >
              {effectiveCollapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 text-zinc-400 hover:text-white hover:bg-zinc-800"
                      onClick={signOut}
                    >
                      <div className="h-6 w-6 rounded-full bg-[#ff0073]/20 flex items-center justify-center text-[#ff0073] text-xs font-medium">
                        {user.email?.[0]?.toUpperCase() || "U"}
                      </div>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-zinc-800 text-white border-zinc-700">
                    <div className="text-xs">{user.email}</div>
                    <div className="text-xs text-zinc-400">Click to sign out</div>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-6 w-6 rounded-full bg-[#ff0073]/20 flex items-center justify-center text-[#ff0073] text-xs font-medium flex-shrink-0">
                      {user.email?.[0]?.toUpperCase() || "U"}
                    </div>
                    <span className="text-xs text-zinc-400 truncate">{user.email}</span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-zinc-400 hover:text-white hover:bg-zinc-800 flex-shrink-0"
                        onClick={signOut}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="bg-zinc-800 text-white border-zinc-700">
                      Sign out
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          )}

          {/* Theme toggle */}
          {effectiveCollapsed ? (
            <div className="flex justify-center">
              <ThemeToggle />
            </div>
          ) : (
            <ThemeToggle />
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}

interface MobileHeaderProps {
  readonly onMenuClick: () => void
}

export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b bg-zinc-950 md:hidden">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-zinc-400 hover:text-white hover:bg-zinc-800"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <span className="text-sm font-bold text-[#ff0073]">SceneNode</span>
      <div className="ml-auto">
        <ThemeToggle />
      </div>
    </header>
  )
}
