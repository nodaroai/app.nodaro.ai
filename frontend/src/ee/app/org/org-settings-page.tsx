import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { GrantedAccess, OrgSettings, WorkflowVisibility } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { queryKeys } from "@/lib/query-keys"
import { hydrateWorkspaces } from "@/lib/workspace-context"
import { useWorkspace } from "@/ee/hooks/use-workspace"
import { useOrgVocabulary } from "@/ee/hooks/use-org-vocabulary"
import { pluralWorkspaceWord } from "@/ee/lib/org-vocabulary"
import { useT, type MessageKey, type TFunction } from "@/lib/i18n"
import { OrgApiError, getOrganization, updateOrganization } from "@/ee/lib/orgs-api"
import { ORG_STATUS_KEYS } from "./org-overview-page"

/**
 * `/org/:slug/settings` — the name, the defaults, and who may join.
 *
 * Every setting here changes what other people can see or do, so each one is
 * asked as a QUESTION about its consequence rather than named by its key:
 * "What may administrators do with a member's work?" beats "admin_access",
 * and someone changing it can tell from the label alone whether they mean to.
 *
 * Each toggle spells out BOTH answers underneath, and the one currently in
 * force is the emphasised one. A switch whose label is a statement makes the
 * reader work out what the off position means; here it is written down. Keep
 * every setting in this shape — one entry phrased differently reads as a
 * mistake, and a page of near-identical rows is scanned, not read.
 *
 * A setting has THREE states here, not two. `settings` arrives as the RAW
 * stored jsonb — the API does not resolve it against the kind preset — so a
 * key the organization never touched is `undefined`, and its real value is
 * whatever the preset says. Emphasising an answer in that case states
 * something false: a fresh school follows a preset where members DO keep a
 * personal space, admins CAN invite, and per-member caps ARE on, while an
 * unset boolean reads as `false` and would emphasise the opposite of all
 * three. So an untouched setting emphasises NEITHER answer and says it is
 * following the default — the same thing the three selects below already do
 * with their "The default for this kind of organization" placeholder.
 *
 * Only what was actually edited is sent. The server merges a partial patch
 * over what it already holds, so sending the whole object would overwrite a
 * setting another administrator changed thirty seconds ago with the value
 * this page happened to load.
 */

interface BooleanSetting {
  key: keyof OrgSettings
  /** Asked of the administrator, and answered by the switch beside it. */
  questionKey: MessageKey
  /** What being on means, in the same voice as the question. */
  whenYesKey: MessageKey
  /** What being off means. Never "the opposite of the above" — spell it out. */
  whenNoKey: MessageKey
}

const BOOLEAN_SETTINGS: readonly BooleanSetting[] = [
  {
    key: "members_can_create_projects",
    questionKey: "org.setCreateProjectsQ",
    whenYesKey: "org.setCreateProjectsYes",
    whenNoKey: "org.setCreateProjectsNo",
  },
  {
    key: "personal_space_enabled",
    questionKey: "org.setPersonalSpaceQ",
    whenYesKey: "org.setPersonalSpaceYes",
    whenNoKey: "org.setPersonalSpaceNo",
  },
  {
    key: "workspace_admins_can_invite",
    questionKey: "org.setWsAdminsInviteQ",
    whenYesKey: "org.setWsAdminsInviteYes",
    whenNoKey: "org.setWsAdminsInviteNo",
  },
  {
    key: "collaborators_can_invite",
    questionKey: "org.setCollabInviteQ",
    whenYesKey: "org.setCollabInviteYes",
    whenNoKey: "org.setCollabInviteNo",
  },
  {
    key: "policy_survives_suspension",
    questionKey: "org.setPolicySuspendedQ",
    whenYesKey: "org.setPolicySuspendedYes",
    whenNoKey: "org.setPolicySuspendedNo",
  },
  {
    key: "member_caps_enabled",
    questionKey: "org.setMemberCapsQ",
    whenYesKey: "org.setMemberCapsYes",
    whenNoKey: "org.setMemberCapsNo",
  },
]

export default function OrgSettingsPage() {
  const t = useT()
  const { slug = "" } = useParams<{ slug: string }>()
  const queryClient = useQueryClient()
  const { organizations, status: membershipStatus } = useWorkspace()

  const membership = organizations.find((o) => o.slug === slug) ?? null
  const orgId = membership?.id ?? ""
  const vocabulary = useOrgVocabulary(membership?.vocabulary)
  const vocabularyWord = vocabulary.workspace
  const workspaceWord = vocabularyWord ?? t("org.workspaceWord")
  // The organization's own word, pluralized; without one, the plural comes from the dictionary.
  const workspacesWord = pluralWorkspaceWord(vocabulary, t)
  const canManage = membership?.role === "owner" || membership?.role === "admin"

  const org = useQuery({
    queryKey: queryKeys.orgs.detail(orgId),
    queryFn: () => getOrganization(orgId),
    enabled: canManage && orgId !== "",
    retry: false,
  })

  const [name, setName] = useState("")
  const [edited, setEdited] = useState<OrgSettings>({})
  const [dirty, setDirty] = useState(false)
  // The domain field holds the RAW text. Deriving its value from the parsed
  // array fights the typist: the space after a comma re-parses to an array
  // whose join() has no trailing separator, so the character is erased as
  // fast as it is typed. Parse once, on save.
  const [domainsText, setDomainsText] = useState("")

  useEffect(() => {
    if (!org.data || dirty) return
    setName(org.data.name)
    setDomainsText((org.data.settings?.allowed_email_domains ?? []).join(", "))
  }, [org.data, dirty])

  const parsedDomains = domainsText
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0)
  const storedDomains = org.data?.settings?.allowed_email_domains ?? []
  // Joined on a character no domain can contain, so ["a.test b"] and
  // ["a.test", "b"] are not mistaken for the same list.
  const domainsChanged = parsedDomains.join("|") !== storedDomains.join("|")
  const settingsPatch: OrgSettings = {
    ...edited,
    ...(domainsChanged ? { allowed_email_domains: parsedDomains } : {}),
  }

  const save = useMutation({
    mutationFn: () =>
      updateOrganization(orgId, {
        ...(name.trim() !== org.data?.name ? { name: name.trim() } : {}),
        // Only what changed: the server merges over what it holds, so sending
        // everything would overwrite another administrator's edit with a value
        // this page loaded before it.
        ...(Object.keys(settingsPatch).length > 0 ? { settings: settingsPatch } : {}),
      }),
    onSuccess: async () => {
      setEdited({})
      setDirty(false)
      await hydrateWorkspaces()
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.all })
    },
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
              ? t("org.settingsOwnerAdminOnly")
              : t("org.orgMissingOrNotMember")}
          </p>
          <Button asChild variant="outline">
            <Link to={membership ? `/org/${slug}` : "/"}>{t("common.back")}</Link>
          </Button>
        </Card>
      </div>
    )
  }

  if (org.isLoading) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>

  const stored: OrgSettings = org.data?.settings ?? {}
  const value = <K extends keyof OrgSettings>(key: K): OrgSettings[K] => edited[key] ?? stored[key]
  const set = <K extends keyof OrgSettings>(key: K, next: OrgSettings[K]) => {
    setDirty(true)
    setEdited((prev) => ({ ...prev, [key]: next }))
  }

  const isActive = membership.status === "active"
  const hasChanges = dirty && (name.trim() !== org.data?.name || Object.keys(settingsPatch).length > 0)

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("common.settings")}</h1>
        <Link to={`/org/${slug}`} className="text-sm text-muted-foreground hover:underline">
          {membership.name}
        </Link>
      </header>

      {!isActive && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          {t("org.nothingChangesWhileStatus", {
            status: ORG_STATUS_KEYS[membership.status] ? t(ORG_STATUS_KEYS[membership.status]) : membership.status,
          })}
        </p>
      )}

      <Card className="space-y-4 p-6">
        <div className="space-y-2">
          <Label htmlFor="org-name">{t("common.name")}</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => {
              setDirty(true)
              setName(e.target.value)
            }}
            maxLength={120}
            disabled={!isActive || save.isPending}
          />
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <h2 className="font-medium">{t("org.whatPeopleCanDo")}</h2>

        <div className="space-y-2">
          <Label htmlFor="admin-access">{t("org.adminAccessQ")}</Label>
          <Select
            value={value("admin_access") ?? ""}
            onValueChange={(v) => set("admin_access", v as GrantedAccess)}
            disabled={!isActive || save.isPending}
          >
            <SelectTrigger id="admin-access">
              <SelectValue placeholder={t("org.defaultForKind")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">{t("org.accessView")}</SelectItem>
              <SelectItem value="edit">{t("org.accessEdit")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="shared-access">
            {t("org.memberAccessSharedQ", { workspace: workspaceWord.toLowerCase() })}
          </Label>
          <Select
            value={value("member_access_to_shared") ?? ""}
            onValueChange={(v) => set("member_access_to_shared", v as GrantedAccess)}
            disabled={!isActive || save.isPending}
          >
            <SelectTrigger id="shared-access">
              <SelectValue placeholder={t("org.defaultForKind")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">{t("org.accessView")}</SelectItem>
              <SelectItem value="edit">{t("org.accessEdit")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="default-visibility">{t("org.newWorkVisibilityQ")}</Label>
          <Select
            value={value("default_workflow_visibility") ?? ""}
            onValueChange={(v) => set("default_workflow_visibility", v as WorkflowVisibility)}
            disabled={!isActive || save.isPending}
          >
            <SelectTrigger id="default-visibility">
              <SelectValue placeholder={t("org.defaultForKind")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">{t("org.visibilityPrivate")}</SelectItem>
              <SelectItem value="workspace">{t("org.visibilityWorkspace", { workspace: workspaceWord.toLowerCase() })}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {BOOLEAN_SETTINGS.map((setting) => {
          // undefined = never set for this organization, so the preset decides
          // and this page cannot know which way. Emphasise nothing.
          const chosen = value(setting.key) as boolean | undefined
          const on = chosen === true
          const emphasis = (forAnswer: boolean) =>
            chosen === undefined ? "text-muted-foreground" : chosen === forAnswer ? "text-foreground" : "text-muted-foreground"
          return (
            <div key={setting.key} className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor={`setting-${setting.key}`}>{t(setting.questionKey)}</Label>
                <div className="text-xs">
                  <p className={emphasis(true)}>
                    <span className="font-medium">{t("common.yes")}</span> — {t(setting.whenYesKey)}
                  </p>
                  <p className={emphasis(false)}>
                    <span className="font-medium">{t("common.no")}</span> — {t(setting.whenNoKey)}
                  </p>
                  {chosen === undefined && (
                    <p className="text-foreground">{t("org.followingDefault")}</p>
                  )}
                </div>
              </div>
              <Switch
                id={`setting-${setting.key}`}
                checked={on}
                onCheckedChange={(next) => set(setting.key, next as never)}
                disabled={!isActive || save.isPending}
                aria-label={t(setting.questionKey)}
              />
            </div>
          )
        })}
      </Card>

      <Card className="space-y-3 p-6">
        <div>
          <h2 className="font-medium">{t("org.whoMayJoinWithCode")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("org.allowedDomainsHint")}
          </p>
        </div>
        <Input
          id="allowed-domains"
          aria-label={t("org.allowedDomainsAria")}
          value={domainsText}
          onChange={(e) => {
            setDirty(true)
            setDomainsText(e.target.value)
          }}
          placeholder="school.example"
          disabled={!isActive || save.isPending}
        />
      </Card>

      {save.error && (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{failureMessage(save.error, t)}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button asChild variant="outline">
          <Link to={`/org/${slug}/workspaces`}>{workspacesWord}</Link>
        </Button>
        <Button onClick={() => save.mutate()} disabled={!isActive || save.isPending || !hasChanges}>
          {save.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  )
}

function failureMessage(error: unknown, t: TFunction): string {
  const code = error instanceof OrgApiError ? error.code : "internal_error"
  switch (code) {
    case "insufficient_role":
      return t("org.cannotChangeSettings")
    case "org_not_active":
      return t("org.orgNotActive")
    case "validation_error":
      return error instanceof OrgApiError ? error.message : t("org.valueRefused")
    default:
      return t("org.saveFailedGeneric")
  }
}
