import { useCallback, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { queryKeys } from "@/lib/query-keys"
import { OrgApiError, actOnJoinCode, getJoinCode } from "@/ee/lib/orgs-api"

/**
 * The join code for one workspace.
 *
 * A code is read aloud in a room, so it is displayed the way it will be
 * spoken: grouped in fours, wide-tracked, large. That is not decoration —
 * "BCDFGHJK" read off a screen at the back of a classroom is where a wrong
 * character comes from.
 *
 * What the card has to make unmissable is the trade. A code admits anyone
 * who has it, so the switch says what turning it on means, and rotating
 * says plainly that the old one dies. Nothing here softens either: an
 * administrator who does not understand that a code circulates is the whole
 * risk of having codes at all.
 */
export function JoinCodeCard({
  workspaceId,
  workspaceWord = "workspace",
  disabled = false,
}: {
  workspaceId: string
  workspaceWord?: string
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)

  const code = useQuery({
    queryKey: queryKeys.orgs.joinCode(workspaceId),
    queryFn: () => getJoinCode(workspaceId),
    retry: false,
  })

  const act = useMutation({
    mutationFn: (action: "rotate" | "enable" | "disable") => actOnJoinCode(workspaceId, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.joinCode(workspaceId) })
    },
  })

  const copy = useCallback(async () => {
    if (!code.data?.code) return
    await navigator.clipboard?.writeText(code.data.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [code.data?.code])

  const word = workspaceWord.toLowerCase()
  const enabled = code.data?.enabled ?? false

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">Join code</h2>
          <p className="text-sm text-muted-foreground">
            Anyone who has the code can join this {word} as a member. Read it out, or write it on a board.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={disabled || act.isPending || code.isLoading}
          onCheckedChange={(next) => act.mutate(next ? "enable" : "disable")}
          aria-label="Allow joining with a code"
        />
      </div>

      {code.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {code.error && <p className="text-sm text-muted-foreground">Could not load the join code.</p>}

      {!code.isLoading && !code.error && !code.data && (
        <p className="text-sm text-muted-foreground">
          No code yet. Turning this on will make one.
        </p>
      )}

      {code.data && (
        <div className="space-y-3">
          <p
            className="select-all text-center font-mono text-2xl tracking-[0.35em]"
            aria-label={`Join code ${code.data.code}`}
          >
            {format(code.data.code)}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="outline" onClick={copy} disabled={disabled}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => act.mutate("rotate")} disabled={disabled || act.isPending}>
              New code
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {enabled
              ? "Anyone with this code can join right now."
              : "Joining is off — the code will not work until you turn it on."}
          </p>
          <p className="text-center text-xs text-muted-foreground">
            A new code stops the old one working immediately.
          </p>
        </div>
      )}

      {act.error && (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{failureMessage(act.error)}</p>
      )}
    </Card>
  )
}

/** Grouped in fours, the way it gets read aloud. */
export function format(code: string): string {
  if (code.length !== 8) return code
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function failureMessage(error: unknown): string {
  const code = error instanceof OrgApiError ? error.code : "internal_error"
  switch (code) {
    case "insufficient_role":
      return "You cannot change the join code for this workspace."
    case "workspace_archived":
      return "This workspace is archived, so its join code cannot change."
    case "org_not_active":
      return "This organization is not active."
    default:
      return "Something went wrong. Try again in a moment."
  }
}
