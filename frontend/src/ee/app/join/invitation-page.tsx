import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"
import { hydrateWorkspaces, setActiveWorkspace } from "@/lib/workspace-context"
import { tx, useT, type TFunction } from "@/lib/i18n"
import { useOrgVocabulary } from "@/ee/hooks/use-org-vocabulary"
import { OrgApiError, acceptInvitation, previewInvitation, type InvitationPreview } from "@/ee/lib/orgs-api"
import { formatDate } from "@/lib/i18n/format"

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
  const t = useT()
  const { token = "" } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  const [phase, setPhase] = useState<Phase>("loading")
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null)
  const vocabulary = useOrgVocabulary(preview?.vocabulary)

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
              ? tx("org.inviteLinkInvalid")
              : tx("org.inviteLoadFailed"),
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
    ? t("org.workspaceAtOrg", { workspace: preview.workspaceName, org: preview.orgName })
    : (preview?.orgName ?? t("org.anOrganization"))

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8">
        {phase === "loading" && <p className="text-sm text-muted-foreground">{t("org.loadingInvitation")}</p>}

        {phase === "gone" && (
          <div className="space-y-4">
            <h1 className="text-xl font-semibold">{t("org.invitationCannotBeUsed")}</h1>
            <p className="text-sm text-muted-foreground">
              {problem?.message ?? goneMessage(preview, t)}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/">{t("org.goToNodaro")}</Link>
            </Button>
          </div>
        )}

        {(phase === "ready" || phase === "accepting" || phase === "accepted") && preview && (
          <div className="space-y-5">
            <div className="space-y-2">
              <h1 className="text-xl font-semibold">
                {preview.inviterName ? t("org.inviterInvitedYou", { name: preview.inviterName }) : t("org.youHaveBeenInvited")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("org.toJoin")}{t("common.fragmentGap")}<span className="font-medium text-foreground">{place}</span>
                {preview.workspaceName ? t("org.aWorkspaceSuffix", { workspace: (vocabulary.workspace ?? t("org.workspaceWord")).toLowerCase() }) : ""}
                {t("common.sentenceEnd")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("org.sentToEmail", { email: preview.email })}
              </p>
            </div>

            {problem && (
              <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{problem.message}</p>
            )}

            {authLoading ? (
              <Button disabled className="w-full">
                {t("org.checkingSession")}
              </Button>
            ) : user ? (
              <Button onClick={accept} disabled={phase !== "ready"} className="w-full">
                {phase === "accepting" ? t("org.joining") : t("org.joinName", { name: preview.workspaceName ?? preview.orgName })}
              </Button>
            ) : (
              <div className="space-y-2">
                {/* The token rides in the redirect so signing in returns here
                    rather than to a dashboard that says nothing about it. */}
                <Button asChild className="w-full">
                  <Link to={`/login?redirect=${encodeURIComponent(`/join/${token}`)}`}>{t("org.signInToAccept")}</Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link to={`/signup?redirect=${encodeURIComponent(`/join/${token}`)}`}>{t("auth.createAccount")}</Link>
                </Button>
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              {t("org.invitationExpires", { date: formatDate(preview.expiresAt) })}
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}

function goneMessage(preview: InvitationPreview | null, t: TFunction): string {
  switch (preview?.state) {
    case "accepted":
      return t("org.inviteAlreadyAcceptedSignIn")
    case "revoked":
      return t("org.inviteWithdrawn")
    case "expired":
      return t("org.inviteExpired")
    default:
      return t("org.inviteLinkInvalid")
  }
}

function acceptFailureMessage(code: string, preview: InvitationPreview | null): string {
  switch (code) {
    case "email_mismatch":
      return preview?.email != null
        ? tx("org.inviteEmailMismatch", { email: preview.email })
        : tx("org.inviteEmailMismatchUnknown")
    case "invitation_expired":
      return tx("org.inviteExpired")
    case "invitation_revoked":
      return tx("org.inviteWithdrawn")
    case "invitation_accepted":
      return tx("org.inviteAlreadyAccepted")
    case "org_not_active":
      return tx("org.orgNotActiveUntilApproved")
    case "invitation_not_found":
      return tx("org.inviteLinkInvalid")
    default:
      return tx("org.joinFailedGeneric")
  }
}
