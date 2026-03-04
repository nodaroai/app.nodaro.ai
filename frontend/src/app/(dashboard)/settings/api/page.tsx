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

export default function ApiSettingsPage() {
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
        <p className="text-muted-foreground">API tokens require Business or Cloud edition.</p>
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
      toast.error(err instanceof Error ? err.message : "Failed to create token")
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    try {
      await updateMutation.mutateAsync({ id, isActive: !isActive })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update token")
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteMutation.mutateAsync(id)
      setDeletingId(null)
      toast.success("Token deleted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete token")
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
          <h1 className="text-2xl font-bold">API Tokens</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create tokens to execute your workflows programmatically via REST API.
          </p>
        </div>
      </div>

      {/* Token List */}
      <div className="space-y-3 mb-6">
        {(tokens ?? []).length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center">
            <Key className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              No API tokens yet. Create one to get started.
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
                  <span>{token.rateLimit} req/min</span>
                  {token.lastUsedAt && (
                    <span>Last used {new Date(token.lastUsedAt).toLocaleDateString()}</span>
                  )}
                  <span>Created {new Date(token.createdAt).toLocaleDateString()}</span>
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
        Create Token
      </Button>
      {(tokens ?? []).length >= 10 && (
        <p className="text-xs text-muted-foreground mt-2">Maximum 10 tokens reached.</p>
      )}

      {/* Usage Examples */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-3">Usage Examples</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Replace <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">YOUR_TOKEN</code> and <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">WORKFLOW_ID</code> with your values.
        </p>

        <div className="space-y-4">
          <CodeExample
            title="Get Schema"
            code={`curl -H 'Authorization: Bearer YOUR_TOKEN' \\
  '${window.location.origin}/v1/api/schema?workflowId=WORKFLOW_ID'`}
          />
          <CodeExample
            title="Run Workflow (async)"
            code={`curl -X POST -H 'Authorization: Bearer YOUR_TOKEN' \\
  -H 'Content-Type: application/json' \\
  '${window.location.origin}/v1/api/run' \\
  -d '{"workflowId": "WORKFLOW_ID", "inputs": {"node_id": {"text": "A sunset"}}}'`}
          />
          <CodeExample
            title="Run Workflow (sync, wait for result)"
            code={`curl -X POST -H 'Authorization: Bearer YOUR_TOKEN' \\
  -H 'Content-Type: application/json' \\
  '${window.location.origin}/v1/api/run?wait=true&timeout=120' \\
  -d '{"workflowId": "WORKFLOW_ID", "inputs": {"node_id": {"text": "A sunset"}}}'`}
          />
          <CodeExample
            title="Check Status"
            code={`curl -H 'Authorization: Bearer YOUR_TOKEN' \\
  '${window.location.origin}/v1/api/status/EXECUTION_ID'`}
          />
          <CodeExample
            title="Get Result"
            code={`curl -H 'Authorization: Bearer YOUR_TOKEN' \\
  '${window.location.origin}/v1/api/result/EXECUTION_ID'`}
          />
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
              {createdToken ? "Token Created" : "Create API Token"}
            </DialogTitle>
          </DialogHeader>

          {createdToken ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <p className="text-sm text-amber-800 dark:text-amber-300">
                  Copy this token now. It won&apos;t be shown again.
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
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  placeholder="e.g., Production API"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="rate-limit">Rate Limit (requests/min)</Label>
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
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newTokenName.trim() || createMutation.isPending}
                  className="bg-[#ff0073] hover:bg-[#e00067] text-white"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Create
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
            <DialogTitle>Delete Token</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently revoke this API token. Any integrations using it will stop working.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && handleDelete(deletingId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CodeExample({ title, code }: { title: string; code: string }) {
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
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="p-3 text-xs font-mono overflow-x-auto text-foreground/80 whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  )
}
