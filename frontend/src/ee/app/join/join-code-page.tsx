import { useCallback, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { hydrateWorkspaces, setActiveWorkspace } from "@/lib/workspace-context"
import { OrgApiError, joinByCode } from "@/ee/lib/orgs-api"

/**
 * `/join` — joining with a code someone read aloud.
 *
 * The code is typed by a person who heard it, so the field accepts what a
 * person types: any case, with or without the hyphen, and the letters the
 * alphabet deliberately excludes because they are misheard (O for zero, I
 * and L for one). Normalizing all of that server-side means the client never
 * has to decide whether "O" was a letter, and one implementation of the
 * folding rule exists instead of two.
 *
 * Every refusal is deliberately vague about WHICH workspace a code belongs
 * to, because a code is guessable: a wrong one, a disabled one and one for
 * an archived workspace are the same answer, so trying codes teaches
 * nothing.
 */
export default function JoinCodePage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (busy || code.trim().length === 0) return
      setBusy(true)
      setProblem(null)
      try {
        const result = await joinByCode(code.trim())
        await hydrateWorkspaces()
        setActiveWorkspace(result.workspaceId)
        navigate(`/w/${result.workspaceId}`, { replace: true })
      } catch (err: unknown) {
        setProblem(failureMessage(err instanceof OrgApiError ? err.code : "internal_error"))
      } finally {
        setBusy(false)
      }
    },
    [busy, code, navigate],
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md p-8">
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Join with a code</h1>
            <p className="text-sm text-muted-foreground">
              Enter the code you were given. It is eight characters, and the hyphen is optional.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="join-code">Join code</Label>
            <Input
              id="join-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="BCDF-GHJK"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              // Wide tracking so a code read off the screen is easy to check
              // against a code read aloud.
              className="text-center text-lg tracking-[0.3em] uppercase"
              disabled={busy || !user}
            />
          </div>

          {problem && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{problem}</p>}

          {authLoading ? (
            <Button disabled className="w-full">
              Checking your session…
            </Button>
          ) : user ? (
            <Button type="submit" disabled={busy || code.trim().length === 0} className="w-full">
              {busy ? "Joining…" : "Join"}
            </Button>
          ) : (
            <Button asChild className="w-full">
              <Link to={`/login?redirect=${encodeURIComponent("/join")}`}>Sign in to join</Link>
            </Button>
          )}
        </form>
      </Card>
    </div>
  )
}

function failureMessage(code: string): string {
  switch (code) {
    case "join_code_invalid":
      // One answer for "no such code", "disabled" and "archived workspace",
      // matching the server: a code is guessable, so trying codes must not
      // reveal which of the three is true.
      return "That code is not valid. Check it and try again, or ask for a new one."
    case "member_suspended":
      return "Your membership is suspended. A code cannot lift that — ask an administrator."
    case "domain_not_allowed":
      return "This organization only admits certain email addresses, and yours is not one of them."
    case "org_not_active":
      return "That organization is not active yet."
    case "rate_limit_exceeded":
      return "Too many attempts. Wait a minute and try again."
    default:
      return "Something went wrong joining. Try again in a moment."
  }
}
