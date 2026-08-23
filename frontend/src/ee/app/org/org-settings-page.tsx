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
import { pluralize } from "@/ee/lib/pluralize"
import { OrgApiError, getOrganization, updateOrganization } from "@/ee/lib/orgs-api"

/**
 * `/org/:slug/settings` — the name, the defaults, and who may join.
 *
 * Every setting here changes what other people can see or do, so each one is
 * labelled by its CONSEQUENCE rather than its key: "What administrators may
 * do with a member's work" beats "admin_access", and someone changing it can
 * tell from the label alone whether they mean to.
 *
 * Only what was actually edited is sent. The server merges a partial patch
 * over what it already holds, so sending the whole object would overwrite a
 * setting another administrator changed thirty seconds ago with the value
 * this page happened to load.
 */

const BOOLEAN_SETTINGS: Array<{ key: keyof OrgSettings; label: string; help: string }> = [
  {
    key: "members_can_create_projects",
    label: "Members can start their own projects",
    help: "Off means work happens inside the places you create.",
  },
  {
    key: "personal_space_enabled",
    label: "Members keep a personal space",
    help: "Their own work, separate from the organization's.",
  },
  {
    key: "workspace_admins_can_invite",
    label: "Workspace admins can invite new people",
    help: "On lets a teacher add a student without an administrator.",
  },
  {
    key: "collaborators_can_invite",
    label: "Collaborators can invite further collaborators",
    help: "Off keeps sharing decisions with the person who owns the work.",
  },
  {
    key: "member_caps_enabled",
    label: "Per-member spending limits",
    help: "Enforced once billing is enabled for organizations.",
  },
]

export default function OrgSettingsPage() {
  const { slug = "" } = useParams<{ slug: string }>()
  const queryClient = useQueryClient()
  const { organizations, status: membershipStatus } = useWorkspace()

  const membership = organizations.find((o) => o.slug === slug) ?? null
  const orgId = membership?.id ?? ""
  const workspaceWord = membership?.vocabulary.workspace ?? "Workspace"
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
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  if (!membership || !canManage) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">{membership ? "Not available to you" : "Organization not found"}</h1>
          <p className="text-sm text-muted-foreground">
            {membership
              ? "Only an owner or an administrator can change these."
              : "This organization does not exist, or you are not a member of it."}
          </p>
          <Button asChild variant="outline">
            <Link to={membership ? `/org/${slug}` : "/"}>Back</Link>
          </Button>
        </Card>
      </div>
    )
  }

  if (org.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>

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
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link to={`/org/${slug}`} className="text-sm text-muted-foreground hover:underline">
          {membership.name}
        </Link>
      </header>

      {!isActive && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          Nothing can be changed while this organization is {membership.status}.
        </p>
      )}

      <Card className="space-y-4 p-6">
        <div className="space-y-2">
          <Label htmlFor="org-name">Name</Label>
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
        <h2 className="font-medium">What people can do</h2>

        <div className="space-y-2">
          <Label htmlFor="admin-access">What administrators may do with a member&apos;s work</Label>
          <Select
            value={value("admin_access") ?? ""}
            onValueChange={(v) => set("admin_access", v as GrantedAccess)}
            disabled={!isActive || save.isPending}
          >
            <SelectTrigger id="admin-access">
              <SelectValue placeholder="The default for this kind of organization" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">See it</SelectItem>
              <SelectItem value="edit">See and change it</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="shared-access">
            What members may do with work shared to a {workspaceWord.toLowerCase()}
          </Label>
          <Select
            value={value("member_access_to_shared") ?? ""}
            onValueChange={(v) => set("member_access_to_shared", v as GrantedAccess)}
            disabled={!isActive || save.isPending}
          >
            <SelectTrigger id="shared-access">
              <SelectValue placeholder="The default for this kind of organization" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">See it</SelectItem>
              <SelectItem value="edit">See and change it</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="default-visibility">Where new work starts</Label>
          <Select
            value={value("default_workflow_visibility") ?? ""}
            onValueChange={(v) => set("default_workflow_visibility", v as WorkflowVisibility)}
            disabled={!isActive || save.isPending}
          >
            <SelectTrigger id="default-visibility">
              <SelectValue placeholder="The default for this kind of organization" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private to whoever made it</SelectItem>
              <SelectItem value="workspace">Visible to the {workspaceWord.toLowerCase()}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {BOOLEAN_SETTINGS.map((setting) => (
          <div key={setting.key} className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor={`setting-${setting.key}`}>{setting.label}</Label>
              <p className="text-xs text-muted-foreground">{setting.help}</p>
            </div>
            <Switch
              id={`setting-${setting.key}`}
              checked={Boolean(value(setting.key))}
              onCheckedChange={(next) => set(setting.key, next as never)}
              disabled={!isActive || save.isPending}
              aria-label={setting.label}
            />
          </div>
        ))}
      </Card>

      <Card className="space-y-3 p-6">
        <div>
          <h2 className="font-medium">Who may join with a code</h2>
          <p className="text-sm text-muted-foreground">
            Leave empty to admit anyone with a code. List domains to admit only those addresses — one per line.
          </p>
        </div>
        <Input
          id="allowed-domains"
          aria-label="Allowed email domains"
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
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{failureMessage(save.error)}</p>
      )}

      <div className="flex justify-end gap-2">
        <Button asChild variant="outline">
          <Link to={`/org/${slug}/workspaces`}>{pluralize(workspaceWord)}</Link>
        </Button>
        <Button onClick={() => save.mutate()} disabled={!isActive || save.isPending || !hasChanges}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}

function failureMessage(error: unknown): string {
  const code = error instanceof OrgApiError ? error.code : "internal_error"
  switch (code) {
    case "insufficient_role":
      return "You cannot change these settings."
    case "org_not_active":
      return "This organization is not active."
    case "validation_error":
      return error instanceof OrgApiError ? error.message : "One of these values was refused."
    default:
      return "Something went wrong saving. Try again in a moment."
  }
}
