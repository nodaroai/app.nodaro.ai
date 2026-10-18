import { Link, useLocation } from "react-router-dom"
import { ChevronLeft, ChevronRight, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { NodaroLogo } from "@/components/nodaro-logo"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"

interface MobileHeaderProps {
  readonly onMenuClick: () => void
}

/** The app's own phone header (below `md`): back to projects, the menu, the logo, the theme switch. */
export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  const t = useT()
  const location = useLocation()
  const isDashboard = location.pathname === "/projects"
  const isRtl = useAppDir() === "rtl"

  return (
    <header className="flex items-center gap-3 px-4 py-3 border-b bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 md:hidden">
      {!isDashboard && (
        <Link
          to="/projects"
          className="h-8 w-8 p-0 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800 touch-manipulation"
          aria-label={t("nav.backToProjects")}
        >
          {isRtl ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </Link>
      )}
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("nav.openMenu")}
        className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800"
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <NodaroLogo size="sm" />
      <div className="ms-auto">
        <ThemeToggle />
      </div>
    </header>
  )
}
