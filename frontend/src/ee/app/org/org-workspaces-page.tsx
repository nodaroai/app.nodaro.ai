import { useState, type FormEvent } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { queryKeys } from "@/lib/query-keys"
import { useWorkspace } from "@/ee/hooks/use-workspace"
import { useOrgVocabulary } from "@/ee/hooks/use-org-vocabulary"
import { pluralWorkspaceWord } from "@/ee/lib/org-vocabulary"
import { useT, type TFunction } from "@/lib/i18n"
import { OrgApiError, createWorkspace, listOrgWorkspaces, setWorkspaceArchived } from "@/ee/lib/orgs-api"
import { ORG_STATUS_KEYS } from "./org-overview-page"

/**
 * `/org/:slug/workspaces` — making and closing the places people work.
 *
 * Archiving is the closest thing here to deleting, and it is deliberately
 * NOT deleting: the work inside stays readable forever. Which is why an
 * archived one is still listed, in its own section, with the way back next
 * to it. A list that hides what was archived turns "where did the class go"
 * into a support question.
 */
export default function OrgWorkspacesPage() {
  const t = useT()
  const { slug = "" } = useParams<{ slug: string }>()
  const queryClient = useQueryClient()
  const { organizations, status: membershipStatus } = useWorkspace()

  const membership = organizations.find((o) => o.slug === slug) ?? null
  const orgId = membership?.id ?? ""
  const vocabulary = useOrgVocabulary(membership?.vocabulary)
  const vocabularyWord = vocabulary.workspace
  const workspaceWord = vocabularyWord ?? t("org.workspaceWordTitle")
  // The organization's own word, pluralized; without one, the plural comes from the dictionary.
  const workspacesWord = pluralWorkspaceWord(vocabulary, t)
  const canManage = membership?.role === "owner" || membership?.role === "admin"

  const [name, setName] = useState("")

  const workspaces = useQuery({
    queryKey: queryKeys.orgs.workspaces(orgId, true),
    queryFn: () => listOrgWorkspaces(orgId, true),
    enabled: canManage && orgId !== "",
    retry: false,
  })

  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.all })

  const create = useMutation({
    mutationFn: (workspaceName: string) => createWorkspace(orgId, { name: workspaceName }),
    onSuccess: () => {
      setName("")
      refresh()
    },
  })
  const archive = useMutation({
    mutationFn: (input: { id: string; archived: boolean }) => setWorkspaceArchived(input.id, input.archived),
    onSuccess: refresh,
  })

  if (membershipStatus === "idle" || membershipStatus === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>
  }

  if (!membership || !canManage) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">{membership ? t("org.notAvailableToYou") : t("org.orgNotFound")}</h1>
          <p className="text-sm text-muted-foreground">
            {membership
              ? t("org.manageThingsOwnerAdminOnly", { things: workspacesWord.toLowerCase() })
              : t("org.orgMissingOrNotMember")}
          </p>
          <Button asChild variant="outline">
            <Link to={membership ? `/org/${slug}` : "/"}>{t("common.back")}</Link>
          </Button>
        </Card>
      </div>
    )
  }

  const all = workspaces.data ?? []
  const live = all.filter((w) => !w.archived)
  const archived = all.filter((w) => w.archived)
  const isActive = membership.status === "active"
  const mutationError = create.error ?? archive.error

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!isActive || create.isPending || name.trim().length === 0) return
    create.mutate(name.trim())
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{workspacesWord}</h1>
        <Link to={`/org/${slug}`} className="text-sm text-muted-foreground hover:underline">
          {membership.name}
        </Link>
      </header>

      {!isActive && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          {t("org.nothingCreatedWhileStatus", {
            status: ORG_STATUS_KEYS[membership.status] ? t(ORG_STATUS_KEYS[membership.status]) : membership.status,
          })}
        </p>
      )}

      {mutationError && (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{failureMessage(mutationError, t)}</p>
      )}

      <Card className="p-6">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor="new-workspace">{t("org.newWorkspace", { workspace: workspaceWord.toLowerCase() })}</Label>
            <Input
              id="new-workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("org.workspaceNamePlaceholder", { workspace: workspaceWord })}
              maxLength={120}
              disabled={!isActive || create.isPending}
            />
          </div>
          <Button type="submit" disabled={!isActive || create.isPending || name.trim().length === 0}>
            {create.isPending ? t("dash.creating") : t("common.create")}
          </Button>
        </form>
      </Card>

      {workspaces.isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
      {workspaces.error && <p className="text-sm text-muted-foreground">{t("org.listLoadFailed")}</p>}

      {!workspaces.isLoading && !workspaces.error && all.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {`${t("org.noPluralYet", { plural: workspacesWord.toLowerCase() })}${t("common.sentenceEnd")}`}
        </p>
      )}

      {live.length > 0 && (
        <ul className="divide-y rounded-md border">
          {live.map((workspace) => (
            <li key={workspace.id} className="flex items-center justify-between gap-3 p-3">
              <Link to={`/w/${workspace.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                {workspace.name}
              </Link>
              <Button
                size="sm"
                variant="outline"
                disabled={!isActive || archive.isPending}
                onClick={() => archive.mutate({ id: workspace.id, archived: true })}
              >
                {t("marketplace.archive")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("marketplace.archivedHeader")}</h2>
          {/* Still listed, on purpose: archiving is not deleting, and a list
              that hides what was archived turns "where did the class go" into
              a support question. */}
          <ul className="divide-y rounded-md border">
            {archived.map((workspace) => (
              <li key={workspace.id} className="flex items-center justify-between gap-3 p-3">
                <Link to={`/w/${workspace.id}`} className="min-w-0 flex-1 truncate text-sm text-muted-foreground hover:underline">
                  {workspace.name}
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!isActive || archive.isPending}
                  onClick={() => archive.mutate({ id: workspace.id, archived: false })}
                >
                  {t("org.reopen")}
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t("org.archivedWsReadable", { workspace: workspaceWord.toLowerCase() })}
          </p>
        </section>
      )}
    </div>
  )
}

function failureMessage(error: unknown, t: TFunction): string {
  const code = error instanceof OrgApiError ? error.code : "internal_error"
  switch (code) {
    case "name_taken":
      return t("org.wsNameTakenTryOther")
    case "insufficient_role":
      return t("org.cannotMakeChange")
    case "org_not_active":
      return t("org.orgNotActiveNoChanges")
    case "validation_error":
      return error instanceof OrgApiError ? error.message : t("org.thatWasRefused")
    default:
      return t("org.somethingWrongTryAgain")
  }
}
