import { useState } from "react"
import { Link } from "react-router-dom"
import { Cloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { getAuthHeaders } from "@/lib/api"
import { CONNECT_START_NETWORK_MESSAGE, interpretConnectStart } from "@/lib/cloud-connect-start"
import { useProviderKeyEditor } from "@/lib/use-provider-key-editor"
import { NodaroScopeDialog } from "@/components/integrations/nodaro-scope-dialog"

/**
 * "Connect a provider to generate" — what a run on an install with no provider
 * gets instead of a disappearing toast (#771).
 *
 * The old surface was a corner toast reading "nodaro.ai is not connected",
 * which named a connection the user may never have set up, vanished on its own,
 * and offered nothing to act on. This states what stopped, that nothing was
 * consumed, and puts both ways forward in the place the need arose.
 *
 * It is triggered by CAPABILITY, not by matching an error string: the caller
 * asks `/v1/setup/status` whether this install has any provider at all. A real
 * provider failure (bad key, upstream outage) still takes the normal toast —
 * only a genuinely unconfigured install lands here.
 */
export interface ConnectProviderDialogProps {
  readonly open: boolean
  /** Label of the node whose run stopped, e.g. "Generate Video". */
  readonly nodeLabel: string
  /**
   * How many OTHER nodes in the same run are also waiting on a provider.
   * Omitted (or 0) hides the line rather than printing "0 other nodes".
   */
  readonly alsoBlockedCount?: number
  readonly onOpenChange: (open: boolean) => void
  /** Re-run the node that stopped. Omitted hides the retry action. */
  readonly onRetry?: () => void
}

export function ConnectProviderDialog({
  open,
  nodeLabel,
  alsoBlockedCount = 0,
  onOpenChange,
  onRetry,
}: ConnectProviderDialogProps) {
  const [connectPending, setConnectPending] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)

  // A pasted nodaro key is a fresh connection — the 4b routing-choice dialog
  // follows it on EVERY paste surface (founder decision, "dialog on both
  // lanes"); this inline lane is no exception. The OAuth lane gets it on the
  // integrations landing instead.
  const keyEditor = useProviderKeyEditor("nodaro", () => {
    setSaved(true)
    setScopeOpen(true)
  })

  async function startConnect() {
    setConnectPending(true)
    setConnectError(null)
    try {
      const headers = await getAuthHeaders()
      if (!headers.Authorization) {
        window.location.href = "/login?redirect=/setup"
        return
      }
      const res = await fetch("/v1/nodaro-connect/start", { method: "POST", headers })
      const json: unknown = await res.json().catch(() => null)
      const outcome = interpretConnectStart(res.status, json)
      if (outcome.kind === "redirect") {
        // The OAuth callback lands on /integrations. Without a return path the
        // user connected in order to continue a run and is left on another
        // screen with the run abandoned — so remember the workflow URL and let
        // the Integrations card bounce back to it (same contract the guided
        // /setup flow already uses).
        localStorage.setItem("nodaro_connect_from", "editor")
        localStorage.setItem("nodaro_connect_return", window.location.pathname + window.location.search)
        window.location.href = outcome.url
        return
      }
      setConnectError(outcome.message)
    } catch {
      setConnectError(CONNECT_START_NETWORK_MESSAGE)
    } finally {
      setConnectPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Run stopped &middot; {nodeLabel}
            </span>
            <DialogTitle className="text-lg font-semibold">Connect a provider to generate</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              This node needs a model provider, and this install has none configured yet.
              Nothing was consumed and your workflow is unchanged.
            </DialogDescription>
            {alsoBlockedCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {/* States what stopped, not what connecting repairs: the count is
                    every failed node in the run and one may have failed for its
                    own reason, so claiming coverage would overreach. */}
                {alsoBlockedCount} other {alsoBlockedCount === 1 ? "node" : "nodes"} in this run also stopped.
              </p>
            )}
          </div>

          <div className="rounded-lg border p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">nodaro.ai</span>
            </div>
            <p className="text-xs text-muted-foreground">1,500 free credits, no credit card.</p>
            <Button size="sm" onClick={() => void startConnect()} disabled={connectPending}>
              {connectPending ? "Opening…" : "Connect"}
            </Button>
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">or use your own key</span>
            <div className="flex gap-2">
              <Input
                value={keyEditor.value}
                onChange={(e) => keyEditor.setValue(e.target.value)}
                onFocus={() => {
                  if (keyEditor.phase === "idle") keyEditor.startEditing()
                }}
                placeholder="NODARO_API_KEY"
                type="password"
                autoComplete="off"
                className="h-9 text-xs"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void keyEditor.save()}
                disabled={keyEditor.busy || keyEditor.value.trim().length === 0}
              >
                {keyEditor.phase === "saving" ? "Saving…" : "Save"}
              </Button>
            </div>
            {keyEditor.error && <p className="text-xs text-destructive">{keyEditor.error}</p>}
            {saved && (
              <p className="text-xs text-muted-foreground">
                Key saved. It takes effect immediately — no restart needed.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <Link
              to="/integrations"
              className="text-xs text-muted-foreground underline underline-offset-2"
              onClick={() => onOpenChange(false)}
            >
              All integrations
            </Link>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Not now
              </Button>
              {onRetry && saved && (
                <Button
                  size="sm"
                  onClick={() => {
                    onOpenChange(false)
                    onRetry()
                  }}
                >
                  Retry
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
      <NodaroScopeDialog open={scopeOpen} onClose={() => setScopeOpen(false)} />
    </Dialog>
  )
}
