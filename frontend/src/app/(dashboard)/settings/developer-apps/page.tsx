import { useState } from "react"
import {
  Loader2,
  Plus,
  Trash2,
  Copy,
  Check,
  KeyRound,
  ArrowLeft,
  AlertTriangle,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import { hasAdmin } from "@/lib/edition"
import { toast } from "sonner"
import { Link } from "react-router-dom"
import {
  useDeveloperApps,
  useCreateDeveloperAppMutation,
  useDeleteDeveloperAppMutation,
} from "@/hooks/queries/use-developer-apps-queries"
import type { DeveloperApp, DeveloperAppStatus } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { ALL_SCOPES, type Scope, SCOPE_DESCRIPTIONS } from "@/lib/dev-app-scopes"

function StatusBadge({ status }: { status: DeveloperAppStatus }) {
  const t = useT()
  if (status === "active") {
    return <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{t("devApps.statusActive")}</Badge>
  }
  if (status === "suspended") {
    return <Badge variant="destructive">{t("devApps.statusSuspended")}</Badge>
  }
  return <Badge variant="outline">{t("devApps.statusPending")}</Badge>
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT()
  // Default resolved inside the component, not as a param default — a default
  // param is evaluated outside hook scope and would stay untranslated.
  const effectiveLabel = label ?? t("devApps.copy")
  const [copied, setCopied] = useState(false)
  function handle() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={handle}
      type="button"
      aria-label={`${effectiveLabel} ${text}`}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  )
}

export default function DeveloperAppsPage() {
  const t = useT()
  const { loading: authLoading } = useAuth()
  const { data: apps, isLoading } = useDeveloperApps()
  const createMutation = useCreateDeveloperAppMutation()
  const deleteMutation = useDeleteDeveloperAppMutation()

  const [showCreate, setShowCreate] = useState(false)
  const [createdApp, setCreatedApp] = useState<{ clientId: string; clientSecret: string } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Create form state
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [redirectUrisText, setRedirectUrisText] = useState("")
  const [allowedOriginsText, setAllowedOriginsText] = useState("")
  const [scopes, setScopes] = useState<Scope[]>([])
  const [acknowledged, setAcknowledged] = useState(false)

  if (!hasAdmin()) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-muted-foreground">
          {t("devApp.editionGate")}
        </p>
      </div>
    )
  }

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  function resetCreateForm() {
    setName("")
    setDescription("")
    setRedirectUrisText("")
    setAllowedOriginsText("")
    setScopes([])
  }

  function parseLines(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  function isHttpsOrLocalhostUrl(s: string): boolean {
    try {
      const u = new URL(s)
      return u.protocol === "https:" || u.hostname === "localhost"
    } catch {
      return false
    }
  }

  function isBareOrigin(s: string): boolean {
    try {
      const u = new URL(s)
      return u.pathname === "/" && u.search === "" && u.hash === ""
    } catch {
      return false
    }
  }

  function toggleScope(s: Scope) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error(t("devApps.nameRequired"))
      return
    }
    const redirectUris = parseLines(redirectUrisText)
    if (redirectUris.length === 0) {
      toast.error(t("devApps.redirectRequired"))
      return
    }
    if (redirectUris.length > 10) {
      toast.error(t("devApps.maxRedirects"))
      return
    }
    for (const u of redirectUris) {
      if (!isHttpsOrLocalhostUrl(u)) {
        toast.error(t("devApps.badRedirect", { uri: u }))
        return
      }
    }
    const allowedOrigins = parseLines(allowedOriginsText)
    if (allowedOrigins.length > 5) {
      toast.error(t("devApps.maxOrigins"))
      return
    }
    for (const o of allowedOrigins) {
      if (!isHttpsOrLocalhostUrl(o) || !isBareOrigin(o)) {
        toast.error(t("devApps.badOrigin", { origin: o }))
        return
      }
    }
    if (scopes.length === 0) {
      toast.error(t("devApps.selectScope"))
      return
    }

    try {
      const result = await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        redirectUris,
        allowedOrigins,
        scopesRequested: scopes,
      })
      setCreatedApp({ clientId: result.clientId, clientSecret: result.clientSecret })
      resetCreateForm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("devApps.failedCreate"))
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id)
      setDeletingId(null)
      toast.success(t("devApps.appDeleted"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("devApps.failedDelete"))
    }
  }

  function closeCreateDialog() {
    setShowCreate(false)
    setCreatedApp(null)
    setAcknowledged(false)
    resetCreateForm()
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/settings"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("devApps.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("devApps.subtitle")}
          </p>
        </div>
      </div>

      {/* App list */}
      <div className="space-y-3 mb-6">
        {(apps ?? []).length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center">
            <KeyRound className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {t("devApps.empty")}
            </p>
          </div>
        )}

        {(apps ?? []).map((appRow: DeveloperApp) => (
          <div
            key={appRow.id}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{appRow.name}</span>
                  <StatusBadge status={appRow.status} />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <code className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-muted-foreground font-mono break-all">
                    {appRow.clientId}
                  </code>
                  <CopyButton text={appRow.clientId} label={t("devApps.copyClientId")} />
                </div>
                {appRow.description && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                    {appRow.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {appRow.scopesRequested.map((s) => (
                    <Badge key={s} variant="outline" className="font-mono text-[10px]">
                      {s}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{t("devApps.created", { date: new Date(appRow.createdAt).toLocaleDateString() })}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
                  <Link to={`/settings/developer-apps/${appRow.id}`}>
                    {t("devApps.view")}
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500"
                  onClick={() => setDeletingId(appRow.id)}
                  aria-label={t("devApps.deleteAria", { name: appRow.name })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create button */}
      <Button
        onClick={() => setShowCreate(true)}
        disabled={(apps ?? []).length >= 5}
        className="bg-[#ff0073] hover:bg-[#e00067] text-white"
      >
        <Plus className="h-4 w-4 mr-2" />
        {t("devApps.createApp")}
      </Button>
      {(apps ?? []).length >= 5 && (
        <p className="text-xs text-muted-foreground mt-2">{t("devApps.maxReached")}</p>
      )}

      {/* Create / Created Dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          if (!open) {
            // Block closing while showing the secret unless user acknowledged it.
            if (createdApp && !acknowledged) return
            closeCreateDialog()
          }
        }}
      >
        <DialogContent
          className="sm:max-w-lg"
          onInteractOutside={(e) => {
            if (createdApp && !acknowledged) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (createdApp && !acknowledged) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>{createdApp ? t("devApps.appCreated") : t("devApps.createDialogTitle")}</DialogTitle>
            {!createdApp && (
              <DialogDescription>
                {t("devApps.createDialogDesc")}
              </DialogDescription>
            )}
          </DialogHeader>

          {createdApp ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <strong>{t("devApps.secretWarningStrong")}</strong> {t("devApps.secretWarningRest")}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground tracking-wide">
                  {t("devApps.clientId")}
                </Label>
                <div className="relative">
                  <code className="block w-full p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm font-mono break-all pr-10">
                    {createdApp.clientId}
                  </code>
                  <div className="absolute right-1 top-1">
                    <CopyButton text={createdApp.clientId} label={t("devApps.copyClientId")} />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground tracking-wide">
                  {t("devApps.clientSecret")}
                </Label>
                <div className="relative">
                  <code className="block w-full p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm font-mono break-all pr-10">
                    {createdApp.clientSecret}
                  </code>
                  <div className="absolute right-1 top-1">
                    <CopyButton text={createdApp.clientSecret} label={t("devApps.copyClientSecret")} />
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="ack"
                  checked={acknowledged}
                  onCheckedChange={(v) => setAcknowledged(v === true)}
                />
                <Label htmlFor="ack" className="text-sm leading-tight cursor-pointer">
                  {t("devApps.ackLabel")}
                </Label>
              </div>

              <DialogFooter>
                <Button onClick={closeCreateDialog} disabled={!acknowledged}>
                  {t("devApps.done")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="app-name">{t("devApps.nameLabel")}</Label>
                <Input
                  id="app-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("devApps.namePlaceholder")}
                  maxLength={100}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="app-desc">{t("devApps.descLabel")}</Label>
                <Textarea
                  id="app-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("devApps.descPlaceholder")}
                  maxLength={500}
                  rows={2}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="app-redirects">{t("devApps.redirectsLabel")}</Label>
                <Textarea
                  id="app-redirects"
                  value={redirectUrisText}
                  onChange={(e) => setRedirectUrisText(e.target.value)}
                  placeholder={"https://app.example.com/oauth/callback\nhttp://localhost:3000/callback"}
                  rows={3}
                  className="mt-1 font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("devApps.redirectsHint")}
                </p>
              </div>

              <div>
                <Label htmlFor="app-origins">{t("devApps.originsLabel")}</Label>
                <Textarea
                  id="app-origins"
                  value={allowedOriginsText}
                  onChange={(e) => setAllowedOriginsText(e.target.value)}
                  placeholder={"https://app.example.com"}
                  rows={2}
                  className="mt-1 font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("devApps.originsHint")}
                </p>
              </div>

              <div>
                <Label>{t("devApps.scopesLabel")}</Label>
                <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                  {ALL_SCOPES.map((s) => (
                    <div key={s} className="flex items-start gap-2">
                      <Checkbox
                        id={`scope-${s}`}
                        checked={scopes.includes(s)}
                        onCheckedChange={() => toggleScope(s)}
                      />
                      <Label
                        htmlFor={`scope-${s}`}
                        className="text-sm leading-tight cursor-pointer flex-1"
                      >
                        <code className="text-xs font-mono">{s}</code>
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {t(SCOPE_DESCRIPTIONS[s])}
                        </span>
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeCreateDialog}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="bg-[#ff0073] hover:bg-[#e00067] text-white"
                >
                  {createMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  )}
                  {t("devApps.createApp")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("devApps.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("devApps.deleteDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && handleDelete(deletingId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("devApps.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
