import { useRouteError, isRouteErrorResponse, Link } from "react-router-dom"
import { AlertTriangle, ArrowLeft, Home, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import NotFound from "@/components/not-found"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"

function isChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk")
  )
}

export default function RouteErrorBoundary() {
  const error = useRouteError()
  const t = useT()
  const isRtl = useAppDir() === "rtl"

  // 404 responses get the dedicated not-found page
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFound />
  }

  // Stale chunk after deployment — auto-reload once per deploy
  if (isChunkError(error)) {
    sessionStorage.setItem("chunk-reload", "1")
    window.location.reload()
    return null
  }

  const message = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText}`
    : error instanceof Error
      ? error.message
      : t("misc.unexpectedError")

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center max-w-lg">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertTriangle className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("common.somethingWentWrong")}
        </h1>
        <p className="mt-3 text-muted-foreground">
          {message}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className={cn("size-4", isRtl && "rotate-180")} />
            {t("misc.goBack")}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RotateCcw className="size-4" />
            {t("misc.reload")}
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
