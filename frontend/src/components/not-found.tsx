import { Link } from "react-router-dom"
import { FileQuestion, ArrowLeft, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"

export default function NotFound() {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
          <FileQuestion className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-7xl font-bold tracking-tight text-foreground">
          404
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          {t("misc.pageNotFound")}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button variant="outline" asChild>
            <Link to={-1 as unknown as string} onClick={(e) => {
              e.preventDefault()
              window.history.back()
            }}>
              <ArrowLeft className={cn("size-4", isRtl && "rotate-180")} />
              {t("misc.goBack")}
            </Link>
          </Button>
          <Button asChild>
            <Link to="/projects">
              <Home className="size-4" />
              {t("misc.home")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
