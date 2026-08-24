import { useEffect, useState } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import {
  Loader2,
  ArrowLeft,
  AlertTriangle,
  Copy,
  Check,
  RotateCw,
  Trash2,
  Save,
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { hasAdmin } from "@/lib/edition"
import { toast } from "sonner"
import {
  useDeveloperApp,
  useUpdateDeveloperAppMutation,
  useDeleteDeveloperAppMutation,
  useRotateSecretMutation,
} from "@/hooks/queries/use-developer-apps-queries"
import type { DeveloperAppStatus } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { ALL_SCOPES, type Scope, SCOPE_DESCRIPTIONS } from "@/lib/dev-app-scopes"

function StatusBadge({ status }: { status: DeveloperAppStatus }) {
  const t = useT()
  if (status === "active") {
    return (
      <Badge
        variant="secondary"
        className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      >
        {t("devApps.statusActive")}
      </Badge>
    )
  }
  if (status === "suspended") {
    return <Badge variant="destructive">{t("devApps.statusSuspended")}</Badge>
  }
  return <Badge variant="outline">{t("devApps.statusPending")}</Badge>
}

function CopyButton({ text }: { text: string }) {
  const t = useT()
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
      aria-label={t("devApp.copyAria", { text })}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  )
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

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export default function DeveloperAppDetailPage() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: appRow, isLoading, error } = useDeveloperApp(id)
  const updateMutation = useUpdateDeveloperAppMutation()
  const deleteMutation = useDeleteDeveloperAppMutation()
  const rotateMutation = useRotateSecretMutation()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [homepageUrl, setHomepageUrl] = useState("")
  const [logoUrl, setLogoUrl] = useState("")
  const [redirectUrisText, setRedirectUrisText] = useState("")
  const [allowedOriginsText, setAllowedOriginsText] = useState("")
  const [scopes, setScopes] = useState<Scope[]>([])

  const [confirmRotate, setConfirmRotate] = useState(false)
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Hydrate form state from server data once loaded.
  useEffect(() => {
    if (!appRow) return
    setName(appRow.name)
    setDescription(appRow.description ?? "")
    setHomepageUrl(appRow.homepageUrl ?? "")
    setLogoUrl(appRow.logoUrl ?? "")
    setRedirectUrisText(appRow.redirectUris.join("\n"))
    setAllowedOriginsText(appRow.allowedOrigins.join("\n"))
    setScopes(appRow.scopesRequested.filter((s): s is Scope => (ALL_SCOPES as readonly string[]).includes(s)))
  }, [appRow])

  if (!hasAdmin()) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-muted-foreground">
          {t("devApp.editionGate")}
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !appRow) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link
          to="/settings/developer-apps"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("common.back")}
        </Link>
        <p className="mt-6 text-muted-foreground">
          {t("devApp.notFound")}
        </p>
      </div>
    )
  }

  function toggleScope(s: Scope) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function handleSave() {
    if (!id) return
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
    if (homepageUrl.trim() && !isHttpsOrLocalhostUrl(homepageUrl.trim())) {
      toast.error(t("devApp.homepageInvalid"))
      return
    }
    if (logoUrl.trim() && !isHttpsOrLocalhostUrl(logoUrl.trim())) {
      toast.error(t("devApp.logoInvalid"))
      return
    }
    if (scopes.length === 0) {
      toast.error(t("devApp.scopeRequired"))
      return
    }

    try {
      await updateMutation.mutateAsync({
        id,
        input: {
          name: name.trim(),
          description: description.trim() || undefined,
          homepageUrl: homepageUrl.trim() || undefined,
          logoUrl: logoUrl.trim() || undefined,
          redirectUris,
          allowedOrigins,
          scopesRequested: scopes,
        },
      })
      toast.success(t("devApp.appUpdated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("devApp.failedUpdate"))
    }
  }

  async function handleRotate() {
    if (!id) return
    try {
      const result = await rotateMutation.mutateAsync(id)
      setRotatedSecret(result.clientSecret)
      setConfirmRotate(false)
      setAcknowledged(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("devApp.failedRotate"))
    }
  }

  async function handleDelete() {
    if (!id) return
    try {
      await deleteMutation.mutateAsync(id)
      toast.success(t("devApps.appDeleted"))
      navigate("/settings/developer-apps")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("devApps.failedDelete"))
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/settings/developer-apps"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{appRow.name}</h1>
            <StatusBadge status={appRow.status} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t("devApp.subtitle")}
          </p>
        </div>
      </div>

      {/* Read-only credentials */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4 mb-6 space-y-3">
        <div>
          <Label className="text-xs uppercase text-muted-foreground tracking-wide">
            {t("devApps.clientId")}
          </Label>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm font-mono break-all">
              {appRow.clientId}
            </code>
            <CopyButton text={appRow.clientId} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <div className="text-sm">
            <p className="font-medium">{t("devApps.clientSecret")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("devApp.secretHiddenHint")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmRotate(true)}
            disabled={rotateMutation.isPending}
          >
            {rotateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RotateCw className="h-4 w-4 mr-2" />
            )}
            {t("devApp.rotate")}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs text-muted-foreground">
          <div>
            <span className="block text-[10px] uppercase tracking-wide">{t("devApp.createdAt")}</span>
            <span>{new Date(appRow.createdAt).toLocaleString()}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide">{t("devApp.updatedAt")}</span>
            <span>{new Date(appRow.updatedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="space-y-4">
        <div>
          <Label htmlFor="edit-name">{t("devApps.nameLabel")}</Label>
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="edit-desc">{t("devApps.descLabel")}</Label>
          <Textarea
            id="edit-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={2}
            className="mt-1"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="edit-homepage">{t("devApp.homepageLabel")}</Label>
            <Input
              id="edit-homepage"
              type="url"
              value={homepageUrl}
              onChange={(e) => setHomepageUrl(e.target.value)}
              placeholder="https://example.com"
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="edit-logo">{t("devApp.logoLabel")}</Label>
            <Input
              id="edit-logo"
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="mt-1 font-mono text-xs"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="edit-redirects">{t("devApps.redirectsLabel")}</Label>
          <Textarea
            id="edit-redirects"
            value={redirectUrisText}
            onChange={(e) => setRedirectUrisText(e.target.value)}
            rows={3}
            className="mt-1 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t("devApps.redirectsHint")}
          </p>
        </div>

        <div>
          <Label htmlFor="edit-origins">{t("devApps.originsLabel")}</Label>
          <Textarea
            id="edit-origins"
            value={allowedOriginsText}
            onChange={(e) => setAllowedOriginsText(e.target.value)}
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

        <div className="flex items-center justify-between pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t("devApp.deleteApp")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="bg-[#ff0073] hover:bg-[#e00067] text-white"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {t("devApp.saveChanges")}
          </Button>
        </div>
      </div>

      {/* Rotate-secret confirmation */}
      <Dialog open={confirmRotate} onOpenChange={(open) => !open && setConfirmRotate(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("devApp.rotateTitle")}</DialogTitle>
            <DialogDescription>
              {t("devApp.rotateDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRotate(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRotate}
              disabled={rotateMutation.isPending}
            >
              {rotateMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              {t("devApp.rotate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotated secret display */}
      <Dialog
        open={!!rotatedSecret}
        onOpenChange={(open) => {
          if (!open && acknowledged) {
            setRotatedSecret(null)
            setAcknowledged(false)
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onInteractOutside={(e) => {
            if (rotatedSecret && !acknowledged) e.preventDefault()
          }}
          onEscapeKeyDown={(e) => {
            if (rotatedSecret && !acknowledged) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("devApp.newSecretTitle")}</DialogTitle>
          </DialogHeader>
          {rotatedSecret && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <strong>{t("devApp.newSecretWarningStrong")}</strong> {t("devApp.newSecretWarningRest")}
                </div>
              </div>

              <div className="relative">
                <code className="block w-full p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm font-mono break-all pr-10">
                  {rotatedSecret}
                </code>
                <div className="absolute right-1 top-1">
                  <CopyButton text={rotatedSecret} />
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="ack-rotate"
                  checked={acknowledged}
                  onCheckedChange={(v) => setAcknowledged(v === true)}
                />
                <Label htmlFor="ack-rotate" className="text-sm leading-tight cursor-pointer">
                  {t("devApp.ackRotate")}
                </Label>
              </div>

              <DialogFooter>
                <Button
                  onClick={() => {
                    setRotatedSecret(null)
                    setAcknowledged(false)
                  }}
                  disabled={!acknowledged}
                >
                  {t("devApps.done")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("devApp.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("devApps.deleteDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              {t("devApps.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
