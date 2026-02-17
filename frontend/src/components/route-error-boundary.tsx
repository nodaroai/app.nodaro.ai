import { useRouteError, isRouteErrorResponse, Link } from "react-router-dom"
import { AlertTriangle, ArrowLeft, Home, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import NotFound from "@/components/not-found"

export default function RouteErrorBoundary() {
  const error = useRouteError()

  // 404 responses get the dedicated not-found page
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFound />
  }

  const message = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred"

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center max-w-lg">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertTriangle className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-3 text-muted-foreground">
          {message}
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="size-4" />
            Go back
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RotateCcw className="size-4" />
            Reload
          </Button>
          <Button asChild>
            <Link to="/projects">
              <Home className="size-4" />
              Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
