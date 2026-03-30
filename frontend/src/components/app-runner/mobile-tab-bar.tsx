import { PenLine, Package, Clock } from "lucide-react"

export type MobileTab = "inputs" | "outputs" | "runs"

interface MobileTabBarProps {
  activeTab: MobileTab
  onTabChange: (tab: MobileTab) => void
  showRunsTab: boolean
  hasUnseenOutputs: boolean
  runCount: number
  hidden?: boolean
}

export function MobileTabBar({
  activeTab,
  onTabChange,
  showRunsTab,
  hasUnseenOutputs,
  runCount,
  hidden,
}: MobileTabBarProps) {
  if (hidden) return null

  const tabs: { id: MobileTab; label: string; icon: typeof PenLine; badge?: React.ReactNode }[] = [
    { id: "inputs", label: "Inputs", icon: PenLine },
    {
      id: "outputs",
      label: "Outputs",
      icon: Package,
      badge: hasUnseenOutputs ? (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#ff0073]" />
      ) : null,
    },
  ]

  if (showRunsTab) {
    tabs.push({
      id: "runs",
      label: "Runs",
      icon: Clock,
      badge:
        runCount > 0 ? (
          <span className="absolute -top-1 -right-2 text-[9px] font-medium text-muted-foreground bg-muted rounded-full px-1 min-w-[16px] text-center">
            {runCount > 99 ? "99+" : runCount}
          </span>
        ) : null,
    })
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 bg-card border-t border-border flex"
      style={{
        paddingBottom: "max(0.25rem, var(--safe-area-bottom, 0px))",
        height: "calc(56px + var(--safe-area-bottom, 0px))",
      }}
    >
      {tabs.map(({ id, label, icon: Icon, badge }) => {
        const isActive = activeTab === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-1.5 touch-manipulation transition-colors ${
              isActive ? "text-[#ff0073]" : "text-muted-foreground"
            }`}
          >
            <span className="relative">
              <Icon className="h-5 w-5" />
              {badge}
            </span>
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
