"use client"

import { useCallback, useEffect, useState } from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { Link } from "react-router-dom"
import { isCloud } from "@/lib/edition"
import {
  cloudCoverageSummary,
  groupProviderTiles,
  providerTiles,
  type ProviderMeta,
  type ProviderSource,
  type ProviderTile,
} from "@/lib/provider-tiles"
import { ProviderKeyRow } from "./provider-key-row"

/**
 * "Model providers" on Integrations (self-hosted editions; null on cloud) —
 * the in-app home for the same provider keys the /setup Install-health grid
 * manages: paste a key here, it is stored encrypted and live without a
 * restart. Reads GET /v1/setup/status (the one source for which providers
 * exist, what is set and from where) and writes through the same
 * /v1/setup/provider-keys routes as the setup screen.
 */

interface ProvidersStatus {
  readonly nodaroCloud?: boolean
  readonly keys: Record<string, boolean>
  readonly sources?: Record<string, ProviderSource>
  readonly meta?: Record<string, ProviderMeta>
}

interface EncryptionStatus {
  readonly ok: boolean
  readonly hint?: string
}

interface SetupStatusSlice {
  readonly checks: {
    readonly providers: ProvidersStatus
    readonly encryption?: EncryptionStatus
  }
}

export function ModelProvidersCard() {
  const [status, setStatus] = useState<SetupStatusSlice | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/v1/setup/status", { cache: "no-store" })
      if (!res.ok) throw new Error(`status ${res.status}`)
      setStatus((await res.json()) as SetupStatusSlice)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isCloud()) return
    void refresh()
  }, [refresh])

  if (isCloud()) return null

  const providers = status?.checks.providers
  const tiles: ProviderTile[] = providers ? providerTiles({ keys: providers.keys, sources: providers.sources, meta: providers.meta }) : []
  const { core, nodeSpecific } = groupProviderTiles(tiles)
  const coverage = cloudCoverageSummary(tiles)
  const connected = providers?.nodaroCloud === true
  const encryptionMissing = status?.checks.encryption ? !status.checks.encryption.ok : false
  const setCount = tiles.filter((t) => t.present).length

  return (
    <section
      aria-labelledby="model-providers-heading"
      className="mb-6 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-5 flex flex-col gap-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ff0073]/10 text-[#ff0073]">
          <KeyRound className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 id="model-providers-heading" className="font-semibold text-gray-900 dark:text-white text-sm">
              Model providers
            </h3>
            {tiles.length > 0 && (
              <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">
                {setCount}/{tiles.length} set
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Your own provider keys, alongside the nodaro.ai connection above. Pasted keys are stored encrypted on this
            server and take effect without a restart; a key set in the environment (.env) wins and is read-only here.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading provider status…
        </div>
      ) : failed || !providers ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Could not read this server&apos;s provider status right now — see{" "}
          <Link to="/setup" className="underline underline-offset-4">
            Install health
          </Link>
          .
        </p>
      ) : (
        <>
          {encryptionMissing && (
            <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-400">
              This server has no instance encryption key, so pasted keys cannot be stored. Set{" "}
              <span className="font-mono">NODARO_ENCRYPTION_KEY</span> (see{" "}
              <Link to="/setup" className="underline underline-offset-4">
                Install health
              </Link>
              ); environment keys keep working.
            </p>
          )}

          <p className="text-xs text-gray-600 dark:text-gray-300">
            {connected ? (
              coverage.uncoveredMissing.length > 0 ? (
                <>
                  Connected via nodaro.ai — image, video, speech and LLM models are covered. Still needs its own key:{" "}
                  {coverage.uncoveredMissing.map((t) => t.name).join(", ")}.
                </>
              ) : (
                <>Connected via nodaro.ai — every provider below is covered; paste a key only to call that vendor directly.</>
              )
            ) : coverage.coveredMissing > 0 ? (
              <>
                Connecting nodaro.ai above clears {coverage.coveredMissing} of the {coverage.coveredMissing + coverage.uncoveredMissing.length}{" "}
                missing keys with one click
                {coverage.uncoveredMissing.length > 0 ? (
                  <> — not covered (own key needed): {coverage.uncoveredMissing.map((t) => t.name).join(", ")}</>
                ) : null}
                .
              </>
            ) : null}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {core.map((tile) => (
              <ProviderKeyRow key={tile.id} tile={tile} onChanged={() => void refresh()} />
            ))}
          </div>

          {nodeSpecific.length > 0 && (
            <div className="flex flex-col gap-3">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Used by specific nodes
                </h4>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  Only needed for the node each one names — leave them empty otherwise.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {nodeSpecific.map((tile) => (
                  <ProviderKeyRow key={tile.id} tile={tile} onChanged={() => void refresh()} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
