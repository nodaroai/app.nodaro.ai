import { useEffect, useRef, useState } from "react"
import { Menu, X, LogIn, LogOut, Shuffle, LayoutGrid, ChevronDown } from "lucide-react"
import { NodaroLogo } from "@/components/nodaro-logo"
import { ThemeToggle } from "@/components/theme-toggle"
import { CreditBalance } from "@/components/credits/CreditBalance"
import { RunTargetSelector } from "@/components/presentation/run-target-selector"
import { ViewModeSelector } from "@/components/presentation/view-mode-selector"
import { hasCredits } from "@/lib/edition"
import type { WorkflowNode } from "@/types/nodes"
import type { PresentationSettings, PresentationViewMode } from "@/hooks/use-workflow-store"

interface MobileAppHeaderProps {
  appName: string
  completedNodes: number
  totalNodes: number
  executionStatus: "idle" | "running" | "completed" | "failed"
  userId?: string
  userEmail?: string
  onSignIn: () => void
  onSignOut: () => void
  onGetCredits: () => void
  supportsRemix: boolean
  onRemix: () => void
  isRemixing: boolean
  nodes: WorkflowNode[]
  presentationSettings: PresentationSettings
  onUpdateSettings: (patch: Partial<PresentationSettings>) => void
  viewMode: PresentationViewMode
  onViewModeChange: (mode: PresentationViewMode) => void
  allowedModes: PresentationViewMode[]
  versions: { version: number; id: string; createdAt: string }[]
  selectedVersion: number | null
  onSelectVersion: (version: number | null) => void
  latestVersion: number
}

export function MobileAppHeader({
  appName,
  completedNodes,
  totalNodes,
  executionStatus,
  userId,
  userEmail,
  onSignIn,
  onSignOut,
  onGetCredits,
  supportsRemix,
  onRemix,
  isRemixing,
  nodes,
  presentationSettings,
  onUpdateSettings,
  viewMode,
  onViewModeChange,
  allowedModes,
  versions,
  selectedVersion,
  onSelectVersion,
  latestVersion,
}: MobileAppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [progressVisible, setProgressVisible] = useState(false)
  const [showVersionPicker, setShowVersionPicker] = useState(false)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef(executionStatus)

  // Auto-close menu when execution starts
  useEffect(() => {
    if (executionStatus === "running") {
      setMenuOpen(false)
    }
  }, [executionStatus])

  // Progress bar visibility logic
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = executionStatus

    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = null
    }

    if (executionStatus === "running") {
      setProgressVisible(true)
    } else if (
      (prev === "running" || prev === "idle") &&
      (executionStatus === "completed" || executionStatus === "failed")
    ) {
      setProgressVisible(true)
      fadeTimerRef.current = setTimeout(() => {
        setProgressVisible(false)
      }, 3000)
    } else if (executionStatus === "idle" && prev === "idle") {
      setProgressVisible(false)
    }

    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [executionStatus])

  const progressPercent =
    totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0

  const progressBarColor =
    executionStatus === "failed" ? "bg-destructive" : "bg-[#ff0073]"

  const isAuthenticated = !!userId

  const displayVersion = selectedVersion !== null ? selectedVersion : latestVersion
  const hasMultipleVersions = versions.length > 1

  return (
    <header
      className="fixed top-0 left-0 right-0 z-30 bg-card border-b border-border"
      style={{ paddingTop: "var(--safe-area-top, 0px)" }}
    >
      {/* Top bar */}
      <div className="flex items-center h-12 px-3 gap-2">
        {/* Logo */}
        <a
          href="/"
          className="shrink-0 flex items-center min-w-[44px] min-h-[44px] justify-center touch-manipulation [&>span]:mt-0"
          aria-label="Nodaro home"
        >
          <NodaroLogo variant="icon" size="sm" />
        </a>

        {/* App name + version — pull closer to logo */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 -ml-2.5">
          <span className="text-sm font-semibold truncate">{appName}</span>
          {hasMultipleVersions && (
            <button
              type="button"
              onClick={() => setShowVersionPicker((v) => !v)}
              className="shrink-0 flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 touch-manipulation hover:bg-muted/80 transition-colors min-h-[28px]"
              aria-label="Select version"
            >
              v{displayVersion}
              <ChevronDown className="h-3 w-3" />
            </button>
          )}
          {!hasMultipleVersions && versions.length === 1 && (
            <span className="shrink-0 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
              v{displayVersion}
            </span>
          )}
        </div>

        {/* Right actions */}
        <ThemeToggle />
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="shrink-0 flex items-center justify-center w-11 h-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors touch-manipulation"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Progress bar */}
      {progressVisible && (
        <div className="h-0.5 w-full bg-muted overflow-hidden">
          <div
            className={`h-full mobile-progress-bar ${progressBarColor}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Hamburger menu sheet + backdrop */}
      {menuOpen && (
        <>
          <div
            className="mobile-menu-backdrop"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="mobile-menu-sheet">
            <div className="flex flex-col divide-y divide-border">
              {/* Credits */}
              {isAuthenticated && hasCredits() && userId && (
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Credits</span>
                  <CreditBalance userId={userId} onClick={onGetCredits} />
                </div>
              )}

              {/* Run target */}
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">Run target</span>
                <RunTargetSelector
                  nodes={nodes}
                  presentationSettings={presentationSettings}
                  onUpdate={onUpdateSettings}
                />
              </div>

              {/* View mode */}
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">View</span>
                <ViewModeSelector
                  viewMode={viewMode}
                  onChange={onViewModeChange}
                  allowedModes={allowedModes}
                />
              </div>

              {/* Version picker (inline dropdown) */}
              {hasMultipleVersions && (
                <div className="px-4 py-3 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setShowVersionPicker((v) => !v)}
                    className="flex items-center justify-between w-full touch-manipulation min-h-[44px]"
                  >
                    <span className="text-sm text-muted-foreground">Version</span>
                    <span className="flex items-center gap-1 text-sm font-medium">
                      {selectedVersion === null
                        ? `v${latestVersion} (latest)`
                        : `v${selectedVersion}`}
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${showVersionPicker ? "rotate-180" : ""}`}
                      />
                    </span>
                  </button>
                  {showVersionPicker && (
                    <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectVersion(null)
                          setShowVersionPicker(false)
                          setMenuOpen(false)
                        }}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm touch-manipulation transition-colors ${
                          selectedVersion === null
                            ? "bg-[#ff0073]/10 text-[#ff0073]"
                            : "hover:bg-muted text-foreground"
                        }`}
                      >
                        v{latestVersion} (latest)
                      </button>
                      {versions
                        .filter((v) => v.version !== latestVersion)
                        .map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              onSelectVersion(v.version)
                              setShowVersionPicker(false)
                              setMenuOpen(false)
                            }}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm touch-manipulation transition-colors ${
                              selectedVersion === v.version
                                ? "bg-[#ff0073]/10 text-[#ff0073]"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            v{v.version}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {new Date(v.createdAt).toLocaleDateString()}
                            </span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {/* Remix */}
              {supportsRemix && (
                <div className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      onRemix()
                      setMenuOpen(false)
                    }}
                    disabled={isRemixing}
                    className="flex items-center gap-2 text-sm touch-manipulation min-h-[44px] text-foreground hover:text-[#ff0073] transition-colors disabled:opacity-50"
                  >
                    <Shuffle className="h-4 w-4" />
                    {isRemixing ? "Remixing..." : "Remix this app"}
                  </button>
                </div>
              )}

              {/* More apps */}
              <div className="px-4 py-3">
                <a
                  href="/apps"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 text-sm touch-manipulation min-h-[44px] text-foreground hover:text-[#ff0073] transition-colors"
                >
                  <LayoutGrid className="h-4 w-4" />
                  More apps
                </a>
              </div>

              {/* Auth */}
              <div className="px-4 py-3">
                {isAuthenticated ? (
                  <div className="flex items-center justify-between gap-2 min-h-[44px]">
                    <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                      {userEmail}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onSignOut()
                        setMenuOpen(false)
                      }}
                      className="flex items-center gap-2 text-sm touch-manipulation text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onSignIn()
                      setMenuOpen(false)
                    }}
                    className="flex items-center gap-2 text-sm touch-manipulation min-h-[44px] text-foreground hover:text-[#ff0073] transition-colors"
                  >
                    <LogIn className="h-4 w-4" />
                    Sign in
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  )
}
