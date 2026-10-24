import { SkipToContent } from "@/components/layout/skip-to-content"

interface AppRunnerLayoutProps {
  showHistory: boolean
  collapsed: boolean
  onCloseHistory: () => void
  sidebar: React.ReactNode
  children: React.ReactNode
}

export function AppRunnerLayout({
  showHistory,
  collapsed,
  onCloseHistory,
  sidebar,
  children,
}: AppRunnerLayoutProps) {
  return (
    <div className="h-[100dvh] flex relative">
      {/* The runs sidebar comes first in reading order; the link jumps past it. */}
      {sidebar && <SkipToContent />}
      {/* Desktop sidebar: always visible when sidebar content exists */}
      {sidebar && (
        <div className="hidden md:block shrink-0">
          <div className="h-full" style={{ paddingTop: 'var(--safe-area-top, 0px)' }}>
            {sidebar}
          </div>
        </div>
      )}

      {/* Mobile sidebar: overlay, toggle-able */}
      {showHistory && sidebar && (
        <>
          <div
            aria-hidden="true"
            className="app-runner-sidebar-backdrop md:hidden"
            onClick={onCloseHistory}
          />
          <div className="app-runner-sidebar-panel md:hidden" style={{ paddingTop: 'var(--safe-area-top, 0px)' }}>
            {sidebar}
          </div>
        </>
      )}

      <main id="main" tabIndex={-1} className="flex-1 flex flex-col min-w-0 relative focus:outline-none">
        {children}
      </main>
    </div>
  )
}
