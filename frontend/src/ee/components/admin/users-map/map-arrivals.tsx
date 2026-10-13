import { HELD_LABEL, STATES, type Acct, type ClusterView } from "./map-model"

/**
 * The bottom-left card's second face: who signed up in the last hours,
 * newest first, each a click away on the floor. The "+N new" chips and the
 * beacons mark them in the scene; this is the list the owner asked for when
 * the scene alone did not say who was new.
 */

export type BottomTab = "clusters" | "new"

/** The windows the owner named, in hours. */
export const ARRIVAL_WINDOWS_H = [1, 3, 6, 12, 24] as const
export type ArrivalWindowH = (typeof ARRIVAL_WINDOWS_H)[number]

export interface Arrival {
  readonly account: Acct
  readonly cluster: ClusterView | null
  /** Whole minutes since the sign-up. */
  readonly agoMin: number
}

/** Sign-ups inside the window, newest first. */
export function arrivalsWithin(accounts: readonly Acct[], clusterByKey: ReadonlyMap<string, ClusterView>, now: number, hours: number): Arrival[] {
  const since = now - hours * 3_600_000
  return accounts
    .filter((a) => a.t !== null && a.t >= since)
    .sort((a, b) => (b.t ?? 0) - (a.t ?? 0))
    .map((a) => ({ account: a, cluster: a.cluster ? (clusterByKey.get(a.cluster) ?? null) : null, agoMin: Math.max(0, Math.round((now - (a.t ?? now)) / 60_000)) }))
}

export function formatAgo(min: number): string {
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min ago` : `${h} h ago`
}

const tabStyle = (on: boolean): React.CSSProperties => ({
  border: 0,
  background: on ? "var(--um-ink)" : "transparent",
  color: on ? "var(--um-surface)" : "inherit",
  borderRadius: 9,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
})

export function BottomTabs({
  tab,
  onTab,
  clusters,
  fresh,
}: {
  readonly tab: BottomTab
  readonly onTab: (t: BottomTab) => void
  readonly clusters: number
  readonly fresh: number
}) {
  return (
    <div role="tablist" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 11, background: "var(--um-line2)" }}>
      <button type="button" role="tab" aria-selected={tab === "clusters"} style={tabStyle(tab === "clusters")} onClick={() => onTab("clusters")}>
        Clusters
        <span className="um-mono" style={{ opacity: 0.7 }}>
          {clusters}
        </span>
      </button>
      <button type="button" role="tab" aria-selected={tab === "new"} style={tabStyle(tab === "new")} onClick={() => onTab("new")}>
        New
        <span className="um-mono" style={{ padding: "0 6px", borderRadius: 6, background: fresh > 0 ? "#ff0073" : "transparent", color: fresh > 0 ? "#fff" : "inherit", opacity: fresh > 0 ? 1 : 0.7 }}>
          {fresh}
        </span>
      </button>
    </div>
  )
}

export function ArrivalsPanel({
  hidden,
  arrivals,
  clustersCount,
  windowH,
  onWindow,
  onTab,
  selected,
  onSelect,
}: {
  readonly hidden: boolean
  readonly arrivals: readonly Arrival[]
  readonly clustersCount: number
  readonly windowH: ArrivalWindowH
  readonly onWindow: (h: ArrivalWindowH) => void
  readonly onTab: (t: BottomTab) => void
  readonly selected: string | null
  readonly onSelect: (id: string) => void
}) {
  return (
    <div
      data-hud="1"
      className={`um-glass um-fade ${hidden ? "um-hidden" : ""}`}
      style={{ position: "absolute", bottom: 16, left: 16, width: 400, borderRadius: 16, display: "flex", flexDirection: "column", maxHeight: "min(260px, 40%)" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px 6px" }}>
        <BottomTabs tab="new" onTab={onTab} clusters={clustersCount} fresh={arrivals.length} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--um-muted)" }}>
          last
          <select
            aria-label="Window"
            value={windowH}
            onChange={(e) => onWindow(Number(e.target.value) as ArrivalWindowH)}
            style={{ border: "1px solid var(--um-line)", borderRadius: 8, background: "var(--um-surface)", color: "inherit", fontSize: 12, padding: "3px 6px" }}
          >
            {ARRIVAL_WINDOWS_H.map((h) => (
              <option key={h} value={h}>
                {h} {h === 1 ? "hour" : "hours"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ overflowY: "auto", overflowX: "hidden", padding: "0 8px 10px" }}>
        {arrivals.length === 0 && (
          <div style={{ padding: 18, textAlign: "center", color: "var(--um-muted)", fontSize: 13 }}>No sign-ups in the last {windowH === 1 ? "hour" : `${windowH} hours`}</div>
        )}
        {arrivals.map(({ account: a, cluster, agoMin }) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a.id)}
            className="um-row"
            title={a.email}
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "62px minmax(0,1fr) 84px 12px",
              gap: 10,
              alignItems: "center",
              padding: "8px 8px",
              border: 0,
              borderRadius: 10,
              background: selected === a.id ? "var(--um-sel)" : "transparent",
              cursor: "pointer",
              textAlign: "start",
              color: "inherit",
            }}
          >
            {cluster ? (
              <span className="um-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: cluster.hue }} />#{cluster.id}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "var(--um-muted)" }}>single desk</span>
            )}
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.email}</span>
              <span style={{ fontSize: 11, color: "var(--um-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATES[a.state].dot }} />
                {STATES[a.state].label}
                {a.quiet ? ` · ${HELD_LABEL}` : ""}
                {cluster ? ` · ${cluster.size} accounts in this cluster` : ""}
              </span>
            </span>
            <span className="um-mono" style={{ fontSize: 11, color: agoMin < 60 ? "#ff0073" : "var(--um-muted)", whiteSpace: "nowrap", textAlign: "end" }}>
              {formatAgo(agoMin)}
            </span>
            <span style={{ color: "var(--um-faint)" }}>›</span>
          </button>
        ))}
      </div>
    </div>
  )
}
