import { useState } from "react"
import {
  Loader2,
  Plus,
  Trash2,
  Copy,
  Check,
  Key,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { hasAdmin } from "@/lib/edition"
import { toast } from "sonner"
import { Link } from "react-router-dom"
import {
  useApiTokens,
  useCreateApiTokenMutation,
  useUpdateApiTokenMutation,
  useDeleteApiTokenMutation,
} from "@/hooks/queries/use-api-tokens-queries"
import { useT } from "@/lib/i18n"

export default function ApiSettingsPage() {
  const t = useT()
  const { user, loading: authLoading } = useAuth()
  const { data: tokens, isLoading } = useApiTokens()
  const createMutation = useCreateApiTokenMutation()
  const updateMutation = useUpdateApiTokenMutation()
  const deleteMutation = useDeleteApiTokenMutation()

  const [showCreate, setShowCreate] = useState(false)
  const [newTokenName, setNewTokenName] = useState("")
  const [newTokenRateLimit, setNewTokenRateLimit] = useState(30)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  if (!hasAdmin()) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-muted-foreground">{t("apiTok.editionGate")}</p>
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

  async function handleCreate() {
    if (!newTokenName.trim()) return
    try {
      const result = await createMutation.mutateAsync({
        name: newTokenName.trim(),
        rateLimit: newTokenRateLimit,
      })
      setCreatedToken(result.token)
      setNewTokenName("")
      setNewTokenRateLimit(30)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("apiTok.failedCreate"))
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    try {
      await updateMutation.mutateAsync({ id, isActive: !isActive })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("apiTok.failedUpdate"))
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id)
      setDeletingId(null)
      toast.success(t("apiTok.tokenDeleted"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("apiTok.failedDelete"))
    }
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
          <h1 className="text-2xl font-bold">{t("apiTok.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("apiTok.subtitle")}
          </p>
        </div>
      </div>

      {/* Token List */}
      <div className="space-y-3 mb-6">
        {(tokens ?? []).length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center">
            <Key className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              {t("apiTok.empty")}
            </p>
          </div>
        )}

        {(tokens ?? []).map((token) => (
          <div
            key={token.id}
            className={cn(
              "rounded-lg border bg-card p-4",
              token.isActive
                ? "border-zinc-200 dark:border-zinc-800"
                : "border-zinc-200/50 dark:border-zinc-800/50 opacity-60",
            )}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{token.name}</span>
                  <code className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-muted-foreground font-mono">
                    {token.prefix}
                  </code>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{t("apiTok.reqPerMin", { n: token.rateLimit })}</span>
                  {token.lastUsedAt && (
                    <span>{t("apiTok.lastUsed", { date: new Date(token.lastUsedAt).toLocaleDateString() })}</span>
                  )}
                  <span>{t("apiTok.created", { date: new Date(token.createdAt).toLocaleDateString() })}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={token.isActive}
                  onCheckedChange={() => handleToggle(token.id, token.isActive)}
                  disabled={updateMutation.isPending}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500"
                  onClick={() => setDeletingId(token.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create Button */}
      <Button
        onClick={() => setShowCreate(true)}
        disabled={(tokens ?? []).length >= 10}
        className="bg-[#ff0073] hover:bg-[#e00067] text-white"
      >
        <Plus className="h-4 w-4 mr-2" />
        {t("apiTok.createToken")}
      </Button>
      {(tokens ?? []).length >= 10 && (
        <p className="text-xs text-muted-foreground mt-2">{t("apiTok.maxReached")}</p>
      )}

      {/* Usage Examples */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-3">{t("apiTok.usageExamples")}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {t("apiTok.replaceHintPre")} <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">YOUR_TOKEN</code> {t("apiTok.replaceHintMid")} <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">WORKFLOW_ID</code> {t("apiTok.replaceHintPost")}
        </p>

        <div className="space-y-4">
          <CodeExample
            title={t("apiTok.exGetSchema")}
            code={`curl -H 'Authorization: Bearer YOUR_TOKEN' \\
  '${window.location.origin}/v1/api/schema?workflowId=WORKFLOW_ID'`}
          />
          <CodeExample
            title={t("apiTok.exRunAsync")}
            code={`curl -X POST -H 'Authorization: Bearer YOUR_TOKEN' \\
  -H 'Content-Type: application/json' \\
  '${window.location.origin}/v1/api/run' \\
  -d '{"workflowId": "WORKFLOW_ID", "inputs": {"node_id": {"text": "A sunset"}}}'`}
          />
          <CodeExample
            title={t("apiTok.exRunSync")}
            code={`curl -X POST -H 'Authorization: Bearer YOUR_TOKEN' \\
  -H 'Content-Type: application/json' \\
  '${window.location.origin}/v1/api/run?wait=true&timeout=120' \\
  -d '{"workflowId": "WORKFLOW_ID", "inputs": {"node_id": {"text": "A sunset"}}}'`}
          />
          <CodeExample
            title={t("apiTok.exCheckStatus")}
            code={`curl -H 'Authorization: Bearer YOUR_TOKEN' \\
  '${window.location.origin}/v1/api/status/EXECUTION_ID'`}
          />
          <CodeExample
            title={t("apiTok.exGetResult")}
            code={`curl -H 'Authorization: Bearer YOUR_TOKEN' \\
  '${window.location.origin}/v1/api/result/EXECUTION_ID'`}
          />
        </div>

        <div className="mt-6 pt-4 border-t">
          <h3 className="text-sm font-semibold mb-2">{t("apiTok.buildWith")}</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>
              <a className="text-primary hover:underline" href="https://www.npmjs.com/package/@nodaro/sdk" target="_blank" rel="noreferrer">TypeScript SDK — @nodaro/sdk</a>
              <span> {t("apiTok.sdkDesc")}</span>
            </li>
            <li>
              <a className="text-primary hover:underline" href="https://www.npmjs.com/package/@nodaro/cli" target="_blank" rel="noreferrer">CLI — @nodaro/cli</a>
              <span> {t("apiTok.cliDesc")}</span>
            </li>
            <li>
              <a className="text-primary hover:underline" href={`${window.location.origin}/v1/openapi.json`} target="_blank" rel="noreferrer">{t("apiTok.openapiLink")}</a>
              <span> {t("apiTok.openapiDesc")}</span>
            </li>
            <li>
              <a className="text-primary hover:underline" href="https://nodaroai.github.io/app.nodaro.ai/api-integration.html" target="_blank" rel="noreferrer">{t("apiTok.guideLink")}</a>
              <span> {t("apiTok.guideDesc")}</span>
            </li>
            <li>
              <a className="text-primary hover:underline" href="https://nodaroai.github.io/app.nodaro.ai/mcp/" target="_blank" rel="noreferrer">{t("apiTok.mcpLink")}</a>
              <span> {t("apiTok.mcpDesc")}</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => {
        if (!open) {
          setShowCreate(false)
          setCreatedToken(null)
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {createdToken ? t("apiTok.tokenCreated") : t("apiTok.createDialogTitle")}
            </DialogTitle>
          </DialogHeader>

          {createdToken ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  {t("apiTok.copyNowWarning")}
                </p>
              </div>

              <div className="relative">
                <code className="block w-full p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm font-mono break-all pr-10">
                  {createdToken}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-8 w-8 p-0"
                  onClick={() => handleCopy(createdToken)}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>

              <DialogFooter>
                <Button onClick={() => { setShowCreate(false); setCreatedToken(null) }}>
                  {t("apiTok.done")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="token-name">{t("apiTok.nameLabel")}</Label>
                <Input
                  id="token-name"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder={t("apiTok.namePlaceholder")}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="rate-limit">{t("apiTok.rateLimitLabel")}</Label>
                <Input
                  id="rate-limit"
                  type="number"
                  min={1}
                  max={120}
                  value={newTokenRateLimit}
                  onChange={(e) => setNewTokenRateLimit(parseInt(e.target.value, 10) || 30)}
                  className="mt-1"
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newTokenName.trim() || createMutation.isPending}
                  className="bg-[#ff0073] hover:bg-[#e00067] text-white"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t("apiTok.create")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("apiTok.deleteTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("apiTok.deleteDesc")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && handleDelete(deletingId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t("apiTok.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CodeExample({ title, code }: { title: string; code: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCopy}>
          {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
          {copied ? t("apiTok.copied") : t("apiTok.copy")}
        </Button>
      </div>
      <pre className="p-3 text-xs font-mono overflow-x-auto text-foreground/80 whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  )
}
