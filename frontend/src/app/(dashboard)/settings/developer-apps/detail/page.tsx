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

const ALL_SCOPES = [
  "workflows:read",
  "workflows:write",
  "workflows:execute",
  "jobs:read",
  "assets:read",
  "assets:write",
  "credits:read",
  "apps:read",
] as const
type Scope = (typeof ALL_SCOPES)[number]

const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  "workflows:read": "Read workflow definitions and metadata",
  "workflows:write": "Create, update, and delete workflows",
  "workflows:execute": "Trigger workflow executions on the user's behalf",
  "jobs:read": "Read job status and results",
  "assets:read": "Read uploaded media and generated assets",
  "assets:write": "Upload media and create new assets",
  "credits:read": "Read credit balance and usage",
  "apps:read": "Read published apps owned by the user",
}

function StatusBadge({ status }: { status: DeveloperAppStatus }) {
  if (status === "active") {
    return (
      <Badge
        variant="secondary"
        className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      >
        Active
      </Badge>
    )
  }
  if (status === "suspended") {
    return <Badge variant="destructive">Suspended</Badge>
  }
  return <Badge variant="outline">Pending review</Badge>
}

function CopyButton({ text }: { text: string }) {
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
      aria-label={`Copy ${text}`}
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
          Developer apps require Business or Cloud edition.
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
          Back
        </Link>
        <p className="mt-6 text-muted-foreground">
          App not found, or you don&apos;t have access to it.
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
      toast.error("Name is required")
      return
    }
    const redirectUris = parseLines(redirectUrisText)
    if (redirectUris.length === 0) {
      toast.error("At least one redirect URI is required")
      return
    }
    if (redirectUris.length > 10) {
      toast.error("Maximum 10 redirect URIs")
      return
    }
    for (const u of redirectUris) {
      if (!isHttpsOrLocalhostUrl(u)) {
        toast.error(`Redirect URI must be https:// or http://localhost: ${u}`)
        return
      }
    }
    const allowedOrigins = parseLines(allowedOriginsText)
    if (allowedOrigins.length > 5) {
      toast.error("Maximum 5 allowed origins")
      return
    }
    for (const o of allowedOrigins) {
      if (!isHttpsOrLocalhostUrl(o) || !isBareOrigin(o)) {
        toast.error(`Allowed origin must be a bare https:// or http://localhost URL: ${o}`)
        return
      }
    }
    if (homepageUrl.trim() && !isHttpsOrLocalhostUrl(homepageUrl.trim())) {
      toast.error("Homepage URL must be https:// or http://localhost")
      return
    }
    if (logoUrl.trim() && !isHttpsOrLocalhostUrl(logoUrl.trim())) {
      toast.error("Logo URL must be https:// or http://localhost")
      return
    }
    if (scopes.length === 0) {
      toast.error("At least one scope is required")
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
      toast.success("App updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update app")
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
      toast.error(err instanceof Error ? err.message : "Failed to rotate secret")
    }
  }

  async function handleDelete() {
    if (!id) return
    try {
      await deleteMutation.mutateAsync(id)
      toast.success("App deleted")
      navigate("/settings/developer-apps")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete app")
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
            Manage credentials, redirect URIs, and requested scopes.
          </p>
        </div>
      </div>

      {/* Read-only credentials */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-4 mb-6 space-y-3">
        <div>
          <Label className="text-xs uppercase text-muted-foreground tracking-wide">
            Client ID
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
            <p className="font-medium">Client Secret</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Hidden — rotate to generate a new one. Old secret stops working immediately.
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
            Rotate
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800 text-xs text-muted-foreground">
          <div>
            <span className="block text-[10px] uppercase tracking-wide">Created</span>
            <span>{new Date(appRow.createdAt).toLocaleString()}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide">Updated</span>
            <span>{new Date(appRow.updatedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="space-y-4">
        <div>
          <Label htmlFor="edit-name">Name</Label>
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="edit-desc">Description</Label>
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
            <Label htmlFor="edit-homepage">Homepage URL</Label>
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
            <Label htmlFor="edit-logo">Logo URL</Label>
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
          <Label htmlFor="edit-redirects">Redirect URIs (one per line)</Label>
          <Textarea
            id="edit-redirects"
            value={redirectUrisText}
            onChange={(e) => setRedirectUrisText(e.target.value)}
            rows={3}
            className="mt-1 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Must be https:// or http://localhost. Up to 10.
          </p>
        </div>

        <div>
          <Label htmlFor="edit-origins">Allowed origins (one per line)</Label>
          <Textarea
            id="edit-origins"
            value={allowedOriginsText}
            onChange={(e) => setAllowedOriginsText(e.target.value)}
            rows={2}
            className="mt-1 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Bare origin URLs (no path). Used for CORS. Up to 5.
          </p>
        </div>

        <div>
          <Label>Requested scopes</Label>
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
                    {SCOPE_DESCRIPTIONS[s]}
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
            Delete app
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
            Save changes
          </Button>
        </div>
      </div>

      {/* Rotate-secret confirmation */}
      <Dialog open={confirmRotate} onOpenChange={(open) => !open && setConfirmRotate(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rotate client secret?</DialogTitle>
            <DialogDescription>
              The current client secret will stop working immediately. Any deployed integrations
              using it will need to be updated with the new secret.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRotate(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRotate}
              disabled={rotateMutation.isPending}
            >
              {rotateMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Rotate
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
            <DialogTitle>New client secret</DialogTitle>
          </DialogHeader>
          {rotatedSecret && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <strong>This is the only time you&apos;ll see this secret.</strong> Save it now
                  in a secure place — it cannot be recovered.
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
                  I&apos;ve saved my new client secret in a secure place.
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
                  Done
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
            <DialogTitle>Delete this app?</DialogTitle>
            <DialogDescription>
              This will permanently delete the developer app and revoke all access tokens issued
              to it. Users that previously authorized it will need to reconnect.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
