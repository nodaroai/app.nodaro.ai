import { useState } from "react"
import { invalidateNodaroConnectionCache } from "@/hooks/use-nodaro-connection"
import { getAuthHeaders } from "@/lib/api"

/**
 * The paste / change / remove state machine behind a provider tile — shared
 * by the /setup Install-health tile and the Integrations "Model providers"
 * row so the two surfaces cannot drift.
 *
 * The value goes straight to PUT /v1/setup/provider-keys/:id (encrypted at
 * rest, live without a restart) and is dropped from state the moment the
 * request settles — nothing echoes back; a tile only ever shows set /
 * missing and the source.
 */

export type ProviderKeyPhase = "idle" | "editing" | "saving" | "removing" | "toggling"

export interface ProviderKeyEditor {
  readonly phase: ProviderKeyPhase
  readonly value: string
  readonly error: string | null
  /** A request is in flight — disable the controls. */
  readonly busy: boolean
  readonly setValue: (value: string) => void
  readonly startEditing: () => void
  readonly cancel: () => void
  readonly save: () => Promise<boolean>
  readonly remove: () => Promise<void>
  /** Replace-.env (4b): store the pasted key AND skip the env layer. */
  readonly saveReplacingEnv: () => Promise<boolean>
  /** Disable/enable the provider without touching its key (env keys too). */
  readonly setDisabled: (disabled: boolean) => Promise<void>
}

export function useProviderKeyEditor(providerId: string, onChanged: () => void): ProviderKeyEditor {
  const [phase, setPhase] = useState<ProviderKeyPhase>("idle")
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const busy = phase === "saving" || phase === "removing" || phase === "toggling"

  async function request(method: "PUT" | "DELETE", body?: unknown): Promise<boolean> {
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`/v1/setup/provider-keys/${providerId}`, {
        method,
        headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      if (!res.ok) {
        setError(json?.error?.message ?? `Could not ${method === "PUT" ? "save" : "remove"} the key (${res.status})`)
        return false
      }
      // A nodaro key save/remove flips the install's connection state — the
      // editor's NODARO chips read it through the shared cached hook.
      if (providerId === "nodaro") invalidateNodaroConnectionCache()
      return true
    } catch {
      setError("Could not reach this server — check that it is running")
      return false
    }
  }

  async function saveWith(body: Record<string, unknown>): Promise<boolean> {
    const trimmed = value.trim()
    if (!trimmed) {
      setError("Paste a key first")
      return false
    }
    setPhase("saving")
    const ok = await request("PUT", { ...body, value: trimmed })
    // Drop the plaintext either way; the tile shows set/missing, never the value.
    setValue("")
    setPhase(ok ? "idle" : "editing")
    if (ok) onChanged()
    return ok
  }

  const save = (): Promise<boolean> => saveWith({})
  /** The explicit "Replace .env key" action — bypasses the managed_by_env 409. */
  const saveReplacingEnv = (): Promise<boolean> => saveWith({ ignoreEnv: true })

  async function setDisabled(disabled: boolean): Promise<void> {
    setPhase("toggling")
    setError(null)
    try {
      const headers = await getAuthHeaders()
      const res = await fetch(`/v1/setup/provider-keys/${providerId}/disabled`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ disabled }),
      })
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      if (!res.ok) setError(json?.error?.message ?? `Could not ${disabled ? "disable" : "enable"} the provider (${res.status})`)
      else onChanged()
    } catch {
      setError("Could not reach this server — check that it is running")
    } finally {
      setPhase("idle")
    }
  }

  async function remove(): Promise<void> {
    setPhase("removing")
    const ok = await request("DELETE")
    setPhase("idle")
    if (ok) onChanged()
  }

  return {
    phase,
    value,
    error,
    busy,
    setValue,
    startEditing: () => {
      setError(null)
      setPhase("editing")
    },
    cancel: () => {
      setValue("")
      setError(null)
      setPhase("idle")
    },
    save,
    remove,
    saveReplacingEnv,
    setDisabled,
  }
}
