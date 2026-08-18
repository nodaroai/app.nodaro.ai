"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Cloud, Loader2, Unlink } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { getAuthHeaders } from "@/lib/api"
import { isCloud } from "@/lib/edition"
import { NodaroScopeDialog, type NodaroProviderPrefs } from "./nodaro-scope-dialog"

/**
 * "Nodaro Cloud" integration card (community cloud-connect, Phase 4a).
 *
 * Self-hosted editions only (renders null on cloud). Talks exclusively to the
 * instance's own /v1/nodaro-connect/* routes — the cloud token never reaches
 * the browser; the backend proxies status/balance and runs the OAuth flow.
 */

interface NodaroCloudBalance {
  readonly total?: number
  readonly subscription?: number
  readonly topup?: number
}

interface NodaroCloudStatus {
  readonly connected: boolean
  /** "oauth" = the Connect flow (disconnectable here); "env" = NODARO_API_KEY
   *  in .env (read-only here); "app" = an API key pasted on /setup or in
   *  Model providers below (managed there — Change/Remove). */
  readonly source?: "oauth" | "env" | "app"
  readonly balance?: NodaroCloudBalance | null
}

export function NodaroCloudCard() {
  const [status, setStatus] = useState<NodaroCloudStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)
  // Guards the ?nodaro=connected toast against StrictMode double-effects.
  const connectToastShownRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const headers = await getAuthHeaders()
      const res = await fetch("/v1/nodaro-connect/status", { headers })
      if (!res.ok) throw new Error(`status ${res.status}`)
      setStatus((await res.json()) as NodaroCloudStatus)
    } catch {
      // Treat an unreachable status route as "not connected" — the card
      // still offers Connect, and the backend re-checks everything.
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isCloud()) return
    void refresh()
  }, [refresh])

  // The OAuth callback lands the operator back on /integrations?nodaro=connected.
  useEffect(() => {
    if (isCloud() || connectToastShownRef.current) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("nodaro") !== "connected") return
    connectToastShownRef.current = true
    // Guided-setup continuity: when the connect started from /setup, bounce
    // straight back there — step 2 flips done and step 3 lights up.
    if (localStorage.getItem("nodaro_connect_from") === "setup") {
      localStorage.removeItem("nodaro_connect_from")
      window.location.replace("/setup?nodaro=connected")
      return
    }
    toast.success("Connected to nodaro.ai!")
    // The post-connect choice (4b): a fresh OAuth connection asks how it
    // should route, same as a pasted key.
    setScopeDialogOpen(true)
    params.delete("nodaro")
    const query = params.toString()
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    )
  }, [])

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch("/v1/nodaro-connect/start", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      })
      const data = (await res.json().catch(() => null)) as
        | { authorizeUrl?: string; error?: { message?: string } }
        | null
      if (!res.ok || !data?.authorizeUrl) {
        throw new Error(data?.error?.message ?? "Failed to start the connect flow")
      }
      window.location.href = data.authorizeUrl
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start the connect flow")
      setConnecting(false)
    }
  }, [])

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch("/v1/nodaro-connect/disconnect", {
        method: "POST",
        headers,
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      toast.success("Disconnected from nodaro.ai")
      await refresh()
    } catch {
      toast.error("Failed to disconnect")
    } finally {
      setDisconnecting(false)
    }
  }, [refresh])

  if (isCloud()) return null

  const connected = status?.connected === true
  const viaEnvKey = connected && status?.source === "env"
  const viaAppKey = connected && status?.source === "app"
  const totalCredits =
    typeof status?.balance?.total === "number" ? status.balance.total : null

  return (
    <div className="mb-6 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ff0073]/10 text-[#ff0073]">
          <Cloud className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">nodaro.ai</h3>
            {connected && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {connected
              ? viaEnvKey
                ? "This instance generates with nodaro.ai models through NODARO_API_KEY in its .env — billed to that account. Remove the key and restart to disconnect."
                : viaAppKey
                  ? "This instance generates with nodaro.ai models through an API key added in this app — billed to that account. Change or remove it under Model providers below."
                  : "This instance generates with nodaro.ai models through your connected account."
              : "Generate with nodaro.ai models — 1,500 free credits, no credit card. Or set NODARO_API_KEY in .env."}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking connection…
        </div>
      ) : connected ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 dark:bg-[#252525] p-3">
          <div className="min-w-0">
            {totalCredits !== null ? (
              <>
                <span className="block text-sm font-semibold text-gray-900 dark:text-white">
                  {totalCredits.toLocaleString()} credits
                </span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  Cloud account balance
                </span>
              </>
            ) : (
              <span className="block text-sm text-gray-600 dark:text-gray-300">
                Balance unavailable right now
              </span>
            )}
          </div>
          {viaEnvKey || viaAppKey ? (
            <span className="shrink-0 text-[11px] font-mono text-gray-500 dark:text-gray-400">
              {viaEnvKey ? "via NODARO_API_KEY" : "via API key"}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              {disconnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Unlink className="h-3.5 w-3.5 mr-1.5" />
              )}
              Disconnect
            </Button>
          )}
        </div>
      ) : (
        <Button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full sm:w-auto sm:self-start bg-[#ff0073] hover:bg-[#e0005f] text-white"
        >
          {connecting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Connect
        </Button>
      )}
    </div>
  )
}
