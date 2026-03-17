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
            className="app-runner-sidebar-backdrop md:hidden"
            onClick={onCloseHistory}
          />
          <div className="app-runner-sidebar-panel md:hidden" style={{ paddingTop: 'var(--safe-area-top, 0px)' }}>
            {sidebar}
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0 relative">
        {children}
      </div>
    </div>
  )
}
