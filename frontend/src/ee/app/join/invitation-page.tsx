import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"
import { hydrateWorkspaces, setActiveWorkspace } from "@/lib/workspace-context"
import { OrgApiError, acceptInvitation, previewInvitation, type InvitationPreview } from "@/ee/lib/orgs-api"

/**
 * `/join/:token` — where an invitation link lands.
 *
 * PUBLIC, and that is the whole design: the person following it is signed
 * out, often on a device that has never seen this app. They see what they
 * were invited to BEFORE being asked to sign in, because "sign in to find
 * out what this is" is how an invitation gets ignored.
 *
 * Every refusal is a state to render, not a toast to flash: an expired link
 * needs to say who can send a new one, and an address mismatch needs to say
 * which address was invited — masked, since the page is public.
 *
 * The token stays in the URL and is never stored: it is a one-time
 * credential, and the only thing that should outlive this page is the
 * membership it creates.
 */

type Phase = "loading" | "ready" | "accepting" | "accepted" | "gone"

export default function InvitationPage() {
  const { token = "" } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  const [phase, setPhase] = useState<Phase>("loading")
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setPhase("loading")
    previewInvitation(token)
      .then((data) => {
        if (cancelled) return
        setPreview(data)
        setPhase(data.state === "open" ? "ready" : "gone")
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const code = err instanceof OrgApiError ? err.code : "internal_error"
        setProblem({
          code,
          message:
            code === "invitation_not_found"
              ? "This invitation link is not valid. It may have been replaced by a newer one."
              : "We could not load this invitation. Try again in a moment.",
        })
        setPhase("gone")
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const accept = useCallback(async () => {
    setPhase("accepting")
    setProblem(null)
    try {
      const result = await acceptInvitation(token)
      // The memberships this just created are what the switcher renders and
      // what every following request is scoped by, so they are reloaded
      // before navigating rather than after.
      await hydrateWorkspaces()
      if (result.workspaceId) setActiveWorkspace(result.workspaceId)
      setPhase("accepted")
      navigate(result.workspaceId ? `/w/${result.workspaceId}` : "/", { replace: true })
    } catch (err: unknown) {
      const code = err instanceof OrgApiError ? err.code : "internal_error"
      setProblem({ code, message: acceptFailureMessage(code, preview) })
      setPhase(code === "internal_error" ? "ready" : "gone")
    }
  }, [token, navigate, preview])

  const place = preview?.workspaceName
    ? `${preview.workspaceName} at ${preview.orgName}`
    : (preview?.orgName ?? "an organization")

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8">
        {phase === "loading" && <p className="text-sm text-muted-foreground">Loading the invitation…</p>}

        {phase === "gone" && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">This invitation cannot be used</h1>
            <p className="text-sm text-muted-foreground">
              {problem?.message ?? goneMessage(preview)}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">Go to Nodaro</Link>
            </Button>
          </div>
        )}

        {(phase === "ready" || phase === "accepting" || phase === "accepted") && preview && (
          <div className="space-y-5">
            <div className="space-y-2">
              <h1 className="text-xl font-semibold">
                {preview.inviterName ? `${preview.inviterName} invited you` : "You have been invited"}
              </h1>
              <p className="text-sm text-muted-foreground">
                to join <span className="font-medium text-foreground">{place}</span>
                {preview.workspaceName ? ` — a ${label(preview, "workspace").toLowerCase()}` : ""}.
              </p>
              <p className="text-xs text-muted-foreground">
                Sent to {preview.email}. Sign in with that address to accept.
              </p>
            </div>

            {problem && (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{problem.message}</p>
            )}

            {authLoading ? (
              <Button disabled className="w-full">
                Checking your session…
              </Button>
            ) : user ? (
              <Button onClick={accept} disabled={phase !== "ready"} className="w-full">
                {phase === "accepting" ? "Joining…" : `Join ${preview.workspaceName ?? preview.orgName}`}
              </Button>
            ) : (
              <div className="space-y-2">
                {/* The token rides in the redirect so signing in returns here
                    rather than to a dashboard that says nothing about it. */}
                <Button asChild className="w-full">
                  <Link to={`/login?redirect=${encodeURIComponent(`/join/${token}`)}`}>Sign in to accept</Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link to={`/signup?redirect=${encodeURIComponent(`/join/${token}`)}`}>Create an account</Link>
                </Button>
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              This invitation expires {new Date(preview.expiresAt).toLocaleDateString()}.
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}

function label(preview: InvitationPreview, concept: string): string {
  return preview.vocabulary[concept] ?? "workspace"
}

function goneMessage(preview: InvitationPreview | null): string {
  switch (preview?.state) {
    case "accepted":
      return "This invitation has already been accepted. If that was you, sign in and you are already a member."
    case "revoked":
      return "This invitation was withdrawn. Ask whoever invited you to send a new one."
    case "expired":
      return "This invitation has expired. Ask whoever invited you to send a new one."
    default:
      return "This invitation link is not valid. It may have been replaced by a newer one."
  }
}

function acceptFailureMessage(code: string, preview: InvitationPreview | null): string {
  switch (code) {
    case "email_mismatch":
      return `This invitation was sent to ${preview?.email ?? "a different address"}. Sign in with that address to accept it.`
    case "invitation_expired":
      return "This invitation has expired. Ask whoever invited you to send a new one."
    case "invitation_revoked":
      return "This invitation was withdrawn. Ask whoever invited you to send a new one."
    case "invitation_accepted":
      return "This invitation has already been accepted — you are already a member."
    case "org_not_active":
      return "That organization is not active yet. Try again once it has been approved."
    case "invitation_not_found":
      return "This invitation link is not valid. It may have been replaced by a newer one."
    default:
      return "Something went wrong joining. Try again in a moment."
  }
}
