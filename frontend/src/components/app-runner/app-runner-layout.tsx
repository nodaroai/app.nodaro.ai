interface AppRunnerLayoutProps {
  showHistory: boolean
  onCloseHistory: () => void
  sidebar: React.ReactNode
  runsButton: React.ReactNode
  children: React.ReactNode
}

export function AppRunnerLayout({
  showHistory,
  onCloseHistory,
  sidebar,
  runsButton,
  children,
}: AppRunnerLayoutProps) {
  return (
    <div className="h-[100dvh] flex relative">
      {/* Sidebar: overlay on mobile (<768px via CSS), inline on desktop */}
      {showHistory && (
        <>
          {/* Backdrop — visible on mobile only (styled by CSS media query), hidden on desktop */}
          <div
            className="app-runner-sidebar-backdrop md:hidden"
            onClick={onCloseHistory}
          />
          {/* Panel — fixed overlay on mobile (CSS media query), inline flow on desktop */}
          <div className="app-runner-sidebar-panel shrink-0">
            {sidebar}
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0 relative">
        {runsButton}
        {children}
      </div>
    </div>
  )
}
