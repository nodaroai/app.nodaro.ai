"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { BarChart3, Users, Briefcase, Activity, ArrowLeft, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { isFeatureEnabled } from "@/lib/edition"

const ADMIN_NAV = [
  { href: "/admin", label: "Dashboard", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/jobs", label: "Jobs", icon: Briefcase },
  { href: "/admin/usage", label: "Usage", icon: Activity },
] as const

export default function AdminLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAdmin, loading, signOut } = useAuth()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (loading) return

    // Give role a moment to load - loadUser fetches role after onAuthStateChange
    // sets loading=false, so we need a short delay before checking isAdmin
    const timeout = setTimeout(() => {
      if (!isFeatureEnabled('adminPanel') || !user || !isAdmin) {
        router.replace("/projects")
      } else {
        setChecked(true)
      }
    }, 500)

    return () => clearTimeout(timeout)
  }, [user, isAdmin, loading, router])

  if (!checked) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      <aside className="w-56 border-r bg-card flex flex-col">
        <div className="px-4 py-4 border-b">
          <div className="flex items-center gap-2">
            <Link href="/projects">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <span className="text-lg font-bold text-primary">Admin</span>
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 flex flex-col gap-1">
          {ADMIN_NAV.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="px-4 py-3 border-t space-y-2">
          {user && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                {user.email}
              </span>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={signOut}>
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <ThemeToggle />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
