import { useEffect } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { PresentationView } from "@/components/presentation/presentation-view"

export default function PresentPage() {
  const { shareToken } = useParams<{ shareToken: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const loadSharedWorkflow = usePresentationStore((s) => s.loadSharedWorkflow)
  const executionStatus = usePresentationStore((s) => s.executionStatus)
  const errorMessage = usePresentationStore((s) => s.errorMessage)
  const isOwner = usePresentationStore((s) => s.isOwner)
  const hasWorkflow = usePresentationStore((s) => s.workflowId !== null)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate(`/login?redirect=/present/${shareToken}`)
    }
  }, [authLoading, user, navigate, shareToken])

  // Load workflow once authenticated
  useEffect(() => {
    if (user && shareToken) {
      loadSharedWorkflow(shareToken)
    }
  }, [user, shareToken, loadSharedWorkflow])

  if (authLoading || executionStatus === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (errorMessage && executionStatus === "failed" && !hasWorkflow) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">Workflow Not Found</h1>
          <p className="text-muted-foreground mb-4">{errorMessage}</p>
          <button
            onClick={() => navigate("/projects")}
            className="text-[#ff0073] hover:underline"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen">
      <PresentationView
        mode="fullscreen"
        isOwner={isOwner}
      />
    </div>
  )
}
