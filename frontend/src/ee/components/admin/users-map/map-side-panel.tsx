import { useState, type CSSProperties, type ReactNode } from "react"
import { toast } from "sonner"
import { useBlockUser, useRestoreFreeGrant, useRevokeFreeGrant, useUnblockUser } from "@/ee/hooks/queries/use-admin-access"
import { ClusterActionPanel, type ClusterAction } from "@/ee/components/admin/users-linkage/cluster-action-panel"
import { useClusterMembers } from "@/ee/components/admin/users-linkage/use-users-linkage"
import type { LinkageCluster, SizeTier } from "@/ee/components/admin/users-linkage/types"
import { StateBar } from "./map-bottom"
import { ACTIVITY, formatSpan, LINKS, linkSummary, STATE_KEYS, STATES, type Acct, type ClusterView } from "./map-model"
import { formatStamp } from "./timeline-model"

/**
 * The left panel: a selected cluster (what its accounts share, the bulk
 * actions, its members) or a selected account (why it was linked, its own
 * actions). Every action goes through the same per-account routes as the
 * table, so each has its own audit entry.
 */

const card: CSSProperties = { padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }
const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--um-accent)", letterSpacing: ".04em" }
const section: CSSProperties = { fontSize: 12, color: "var(--um-muted)", paddingBottom: 4 }
const pill = (state: Acct["state"]): CSSProperties => ({
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 500,
  background: `color-mix(in srgb, ${STATES[state].dot} 16%, transparent)`,
  color: "var(--um-ink)",
  whiteSpace: "nowrap",
})
const short = (token: string) => (token.length > 12 ? `${token.slice(0, 12)}…` : token)

function Header({ icon, over, title, sub, onClose, closeLabel }: { readonly icon: ReactNode; readonly over: string; readonly title: ReactNode; readonly sub: ReactNode; readonly onClose: () => void; readonly closeLabel: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, background: "var(--um-sel)", display: "grid", placeItems: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <div style={eyebrow}>{over}</div>
        {title}
        <div style={{ fontSize: 12, color: "var(--um-muted)", display: "flex", alignItems: "center", gap: 6 }}>{sub}</div>
      </div>
      <button type="button" className="um-btn" title={closeLabel} aria-label={closeLabel} onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, color: "var(--um-text2)", fontSize: 14 }}>
        ✕
      </button>
    </div>
  )
}

function LinkRow({ link, on, value, note }: { readonly link: (typeof LINKS)[number]; readonly on: boolean; readonly value: string; readonly note: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "26px 96px minmax(0,1fr) auto", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--um-line2)", color: on ? "inherit" : "var(--um-faint)" }}>
      <span style={{ width: 22, height: 0, borderTop: `${link.border} ${on ? link.color : "var(--um-faint2)"}` }} />
      <span style={{ fontSize: 13 }}>{link.label}</span>
      <span dir="ltr" className="um-mono" title={value} style={{ textAlign: "left", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
      <span className="um-mono" style={{ fontSize: 12, fontWeight: 600 }}>
        {note}
      </span>
    </div>
  )
}

const tierOf = (size: number): SizeTier => (size >= 10 ? "large" : size >= 5 ? "medium" : "small")

function asLinkageCluster(c: ClusterView, unresolved: number): LinkageCluster {
  return {
    key: c.key,
    id: c.id,
    size: c.size,
    unresolved,
    tier: tierOf(c.size),
    firstSeenAt: c.firstSeenAt,
    lastSeenAt: c.lastSeenAt,
    withheld: c.counts.withheld,
    granted: c.counts.granted,
    keys: c.keys,
  }
}

export function ClusterPanel({
  cluster,
  canAct,
  blockedIds,
  viewerId,
  onAccount,
  onClose,
  onRunningChange,
}: {
  readonly onRunningChange: (running: boolean) => void
  readonly cluster: ClusterView
  readonly canAct: boolean
  readonly blockedIds: ReadonlySet<string>
  readonly viewerId: string
  readonly onAccount: (id: string) => void
  readonly onClose: () => void
}) {
  const [action, setAction] = useState<ClusterAction | null>(null)
  // Bulk actions act on every member, not only the drawn screens.
  const all = useClusterMembers(action ? cluster.key : null)
  const drawn = Math.max(1, cluster.members.length)
  const span = formatSpan(Date.parse(cluster.lastSeenAt) - Date.parse(cluster.firstSeenAt))
  const actions: ReadonlyArray<{ key: ClusterAction; label: string; n: number; color: string }> = [
    { key: "revoke" as const, label: "Take back all gifts", n: cluster.counts.granted, color: "var(--um-r-fg)" },
    { key: "block" as const, label: "Block all", n: cluster.size - cluster.counts.blocked, color: "var(--um-p-fg)" },
  ].filter((a) => a.n > 0)

  return (
    <div style={card}>
      <Header
        icon={<div style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid var(--um-accent)", background: "var(--um-surface)" }} />}
        over={`Cluster · ${cluster.size} accounts`}
        title={
          <div className="um-mono" style={{ fontSize: 20, fontWeight: 700 }}>
            #{cluster.id}
          </div>
        }
        sub={`${linkSummary(cluster.links)} · opened within ${span}`}
        onClose={onClose}
        closeLabel="Close"
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <StateBar cluster={cluster} height={8} />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
          {STATE_KEYS.filter((k) => cluster.counts[k] > 0).map((k) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: STATES[k].dot }} />
              {STATES[k].label}{" "}
              <b className="um-mono" style={{ fontWeight: 600 }}>
                {cluster.counts[k]}
              </b>
            </span>
          ))}
        </div>
        {cluster.hidden > 0 && (
          <div style={{ fontSize: 12, color: "var(--um-muted)" }}>
            {cluster.members.length} of {cluster.size} drawn — the table lists them all.
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={section}>What they share</div>
        {LINKS.map((l) => {
          const key = cluster.keys.find((k) => k.axis === l.axis)
          const fired = cluster.members.filter((m) => m.fired.includes(l.key)).length
          return <LinkRow key={l.key} link={l} on={Boolean(key)} value={key ? short(key.token) : "Not detected"} note={key ? `${fired}/${drawn}` : ""} />
        })}
      </div>
      {canAct && actions.length > 0 && !action && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {actions.map((a) => (
            <button key={a.key} type="button" className="um-btn" onClick={() => setAction(a.key)} style={{ borderRadius: 10, padding: "9px 10px", fontSize: 13, color: a.color, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {a.label}
              <span className="um-mono" style={{ fontSize: 12, opacity: 0.7 }}>
                {a.n}
              </span>
            </button>
          ))}
        </div>
      )}
      {action && all.isLoading && <div style={{ fontSize: 12, color: "var(--um-muted)" }}>Listing every member…</div>}
      {action && all.error && <div style={{ fontSize: 12, color: "var(--um-r-fg)" }}>{all.error.message}</div>}
      {action && all.data && (
        <ClusterActionPanel
          key={`${cluster.key}:${action}`}
          action={action}
          cluster={asLinkageCluster(cluster, all.data.unresolved)}
          scopeLabel={null}
          members={all.data.members}
          blockedIds={blockedIds}
          viewerId={viewerId}
          onRunningChange={onRunningChange}
          onDone={() => undefined}
          onClose={() => setAction(null)}
        />
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={section}>Members · by sign-up order</div>
        {cluster.members.map((m, i) => (
          <button
            key={m.id}
            type="button"
            className="um-row"
            onClick={() => onAccount(m.id)}
            style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, alignItems: "center", padding: "8px 4px", border: 0, borderBottom: "1px solid var(--um-line2)", background: "transparent", cursor: "pointer", textAlign: "start", color: "inherit" }}
          >
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span dir="ltr" style={{ textAlign: "left", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.email}
              </span>
              <span style={{ fontSize: 11, color: "var(--um-muted)", display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: ACTIVITY[m.act].dot }} />
                {ACTIVITY[m.act].label} · {i === 0 ? "First · " : ""}
                {linkSummary(m.fired) || "Linked"}
              </span>
            </span>
            <span style={pill(m.state)}>{STATES[m.state].label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

type AccountOp = "revoke" | "restore" | "block" | "unblock"

export function AccountPanel({
  account,
  cluster,
  canAct,
  viewerId,
  onCluster,
  onClose,
}: {
  readonly account: Acct
  readonly cluster: ClusterView | null
  readonly canAct: boolean
  readonly viewerId: string
  readonly onCluster: (key: string) => void
  readonly onClose: () => void
}) {
  const revoke = useRevokeFreeGrant()
  const restore = useRestoreFreeGrant()
  const block = useBlockUser()
  const unblock = useUnblockUser()
  const busy = revoke.isPending || restore.isPending || block.isPending || unblock.isPending
  const meta = STATES[account.state]

  const run = async (op: AccountOp) => {
    try {
      if (op === "revoke") await revoke.mutateAsync({ userId: account.id })
      if (op === "restore") await restore.mutateAsync({ userId: account.id })
      if (op === "block") await block.mutateAsync({ userId: account.id, reason: cluster ? `Linked-account cluster #${cluster.id} (map view)` : undefined })
      if (op === "unblock") await unblock.mutateAsync({ userId: account.id })
      toast.success({ revoke: "Free credits taken back", restore: "Free credits restored", block: "Account blocked", unblock: "Account unblocked" }[op])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The request failed")
    }
  }

  const protectedAccount = account.id === viewerId || (account.role !== null && account.role !== "user")
  const ops: ReadonlyArray<{ op: AccountOp; label: string; color: string }> = !canAct
    ? []
    : account.state === "blocked"
      ? [{ op: "unblock", label: "Unblock", color: "inherit" }]
      : [
          ...(account.state === "granted" ? [{ op: "revoke" as const, label: "Take back gift", color: "var(--um-r-fg)" }] : []),
          ...(account.state === "withheld" || account.state === "revoked" ? [{ op: "restore" as const, label: "Restore gift", color: "var(--um-g-fg)" }] : []),
          ...(protectedAccount ? [] : [{ op: "block" as const, label: "Block", color: "var(--um-p-fg)" }]),
        ]

  return (
    <div style={card}>
      <Header
        icon={<div style={{ width: 18, height: 18, borderRadius: 4, background: meta.dot }} />}
        over="Account"
        title={
          <div dir="ltr" style={{ textAlign: "left", fontSize: 16, fontWeight: 700, wordBreak: "break-all" }}>
            {account.email}
          </div>
        }
        sub={
          <>
            {account.t !== null ? `Created ${formatStamp(account.t)} · ` : ""}
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: ACTIVITY[account.act].dot }} />
            {ACTIVITY[account.act].label}
          </>
        }
        onClose={cluster ? () => onCluster(cluster.key) : onClose}
        closeLabel={cluster ? `Back to cluster #${cluster.id}` : "Close"}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ ...pill(account.state), padding: "4px 11px", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{meta.label}</span>
        {cluster && (
          <button type="button" onClick={() => onCluster(cluster.key)} className="um-mono" style={{ cursor: "pointer", border: 0, padding: "4px 9px", borderRadius: 8, background: "var(--um-sel)", color: "var(--um-a-fg)", fontSize: 12 }}>
            #{cluster.id} ×{cluster.size}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--um-text2)", lineHeight: 1.5 }}>{meta.desc}</div>
      {cluster && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={section}>Why · which links fired</div>
          {LINKS.map((l) => {
            const on = account.fired.includes(l.key)
            const token = account.keys?.[l.axis] ?? null
            const shared = token ? cluster.keys.find((k) => k.axis === l.axis && k.token === token) : undefined
            return (
              <LinkRow
                key={l.key}
                link={l}
                on={on}
                value={on && token ? short(token) : "Did not fire"}
                note={on && shared ? `+${Math.max(0, shared.count - 1)}` : ""}
              />
            )
          })}
        </div>
      )}
      {ops.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ops.map((o) => (
            <button key={o.op} type="button" className="um-btn" disabled={busy} onClick={() => void run(o.op)} style={{ borderRadius: 10, padding: "9px 14px", fontSize: 13, color: o.color }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
