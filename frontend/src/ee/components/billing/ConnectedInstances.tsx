import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { getAuthHeaders } from "@/lib/api"
import { tx, useT } from "@/lib/i18n"
import { sectionCardSpaced, MONO_FONT, PINK } from "./billing-styles"
import { formatDate, formatNumber } from "@/lib/i18n/format"

/**
 * Community cloud-connect containment surface (Phase 4a): the user's
 * connected self-hosted instances, their spend this month, a per-instance
 * monthly cap (auto-saved, AR-style debounce — no save button), and
 * one-click revoke. Self-hiding: renders nothing when the user has no
 * connected instances (or the feature flag is off server-side → 404/empty).
 */

interface ConnectedInstance {
  authorizationId: string
  name: string
  instanceUrl: string | null
  connectedAt: string
  lastUsedAt: string | null
  spentThisMonth: number
  monthlySpendCapCredits: number | null
}

async function fetchInstances(): Promise<ConnectedInstance[]> {
  const res = await fetch("/v1/me/connected-instances", { headers: await getAuthHeaders() })
  if (!res.ok) return []
  const body = (await res.json()) as { instances?: ConnectedInstance[] }
  return body.instances ?? []
}

export function ConnectedInstances() {
  const t = useT()
  const [instances, setInstances] = useState<ConnectedInstance[] | null>(null)

  const reload = useCallback(() => {
    fetchInstances().then(setInstances).catch(() => setInstances([]))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  if (!instances || instances.length === 0) return null

  return (
    <section style={sectionCardSpaced}>
      <h2 style={{ fontSize: 19, fontWeight: 700, color: "var(--blg-t1)", letterSpacing: "-0.01em" }}>
        {t("billing.connectedInstances")}
      </h2>
      <p style={{ fontSize: 13.5, color: "var(--blg-t2-dim)", marginTop: 2 }}>
        {t("billing.connectedInstancesDesc")}
      </p>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {instances.map((inst) => (
          <InstanceRow key={inst.authorizationId} inst={inst} onChanged={reload} />
        ))}
      </div>
    </section>
  )
}

function InstanceRow({ inst, onChanged }: { inst: ConnectedInstance; onChanged: () => void }) {
  const t = useT()
  const [cap, setCap] = useState(inst.monthlySpendCapCredits ? String(inst.monthlySpendCapCredits) : "")
  const [revoking, setRevoking] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef(inst.monthlySpendCapCredits ? String(inst.monthlySpendCapCredits) : "")

  useEffect(() => {
    if (cap === lastSavedRef.current) return
    const parsed = /^\d+$/.test(cap) ? parseInt(cap, 10) : null
    const valid = cap === "" || (parsed !== null && parsed >= 100 && parsed <= 1_000_000)
    if (!valid) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/v1/me/connected-instances/${inst.authorizationId}`, {
          method: "PATCH",
          headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
          body: JSON.stringify({ monthlySpendCapCredits: cap === "" ? null : parsed }),
        })
        if (!res.ok) throw new Error(tx("billing.saveCapFailed"))
        lastSavedRef.current = cap
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tx("billing.saveCapFailed"))
      }
    }, 900)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [cap, inst.authorizationId])

  async function handleRevoke() {
    if (!window.confirm(tx("billing.disconnectConfirm", { name: inst.name }))) return
    setRevoking(true)
    try {
      const res = await fetch(`/v1/me/connected-instances/${inst.authorizationId}/revoke`, {
        method: "POST",
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error(tx("integ.toastDisconnectFailed"))
      toast.success(tx("billing.instanceDisconnected"))
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx("integ.toastDisconnectFailed"))
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
        border: "1px solid var(--blg-border-3)",
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--blg-t1)" }}>{inst.name}</div>
        <div style={{ fontFamily: MONO_FONT, fontSize: 11.5, color: "var(--blg-t2-dim)", marginTop: 2 }}>
          {inst.instanceUrl ?? t("billing.unknownHost")} · {t("billing.connectedOn", { date: formatDate(inst.connectedAt) })}
          {inst.lastUsedAt ? ` · ${t("billing.lastUsedOn", { date: formatDate(inst.lastUsedAt) })}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: MONO_FONT, fontSize: 10, letterSpacing: "0.14em", color: "var(--blg-t2-dim)" }}>
          {t("billing.spentThisMonth")}
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--blg-t1)" }}>
          {formatNumber(inst.spentThisMonth)}
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--blg-t1-body)" }}>
        {t("billing.cap")}
        <input
          type="text"
          inputMode="numeric"
          value={cap}
          placeholder={t("cfgext.injRefModeNone")}
          onChange={(e) => setCap(e.target.value.replace(/[^0-9]/g, ""))}
          style={{
            width: 90,
            background: "var(--blg-field-2)",
            border: "1px solid var(--blg-border-input)",
            borderRadius: 8,
            color: "var(--blg-t1)",
            fontSize: 13.5,
            padding: "7px 10px",
            outline: "none",
          }}
          aria-label={t("billing.monthlyCapFor", { name: inst.name })}
        />
      </label>
      <button
        onClick={handleRevoke}
        disabled={revoking}
        style={{
          border: `1px solid ${PINK}`,
          background: "transparent",
          color: PINK,
          fontSize: 13,
          fontWeight: 600,
          padding: "8px 16px",
          borderRadius: 9,
          cursor: "pointer",
          opacity: revoking ? 0.5 : 1,
        }}
      >
        {t("integ.disconnect")}
      </button>
    </div>
  )
}
