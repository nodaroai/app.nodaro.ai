import { linkSummary, STATE_KEYS, STATES, type ClusterView } from "./map-model"
import type { Timeline } from "./timeline-model"

/** The bottom cards: the clusters list (left) and the sign-up timeline (right). */

export function StateBar({ cluster, height }: { readonly cluster: ClusterView; readonly height: number }) {
  const drawn = Math.max(1, cluster.members.length)
  return (
    <span style={{ display: "flex", height, borderRadius: height / 2, overflow: "hidden", background: "var(--um-line2)", width: "100%" }}>
      {STATE_KEYS.filter((k) => cluster.counts[k] > 0).map((k) => (
        <span key={k} style={{ width: `${(cluster.counts[k] / drawn) * 100}%`, background: STATES[k].dot }} />
      ))}
    </span>
  )
}

export function ClusterList({
  hidden,
  clusters,
  selected,
  onSelect,
  partial,
}: {
  readonly hidden: boolean
  readonly clusters: readonly ClusterView[]
  readonly selected: string | null
  readonly onSelect: (key: string) => void
  readonly partial: boolean
}) {
  return (
    <div
      data-hud="1"
      className={`um-glass um-fade ${hidden ? "um-hidden" : ""}`}
      style={{ position: "absolute", bottom: 16, left: 16, width: 400, borderRadius: 16, display: "flex", flexDirection: "column", maxHeight: "min(220px, 34%)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 16px 6px", fontSize: 13, fontWeight: 500 }}>
        Clusters
        <span className="um-mono" style={{ color: "var(--um-accent)" }}>
          {clusters.length}
        </span>
        {partial && <span style={{ fontSize: 11, color: "var(--um-muted)", fontWeight: 400 }}>· the largest are shown</span>}
      </div>
      <div style={{ overflowY: "auto", overflowX: "hidden", padding: "0 8px 10px" }}>
        {clusters.length === 0 && <div style={{ padding: 18, textAlign: "center", color: "var(--um-muted)", fontSize: 13 }}>No linked accounts</div>}
        {clusters.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onSelect(c.key)}
            className="um-row"
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "62px minmax(0,1fr) 72px 12px",
              gap: 10,
              alignItems: "center",
              padding: "9px 8px",
              border: 0,
              borderRadius: 10,
              background: selected === c.key ? "var(--um-sel)" : "transparent",
              cursor: "pointer",
              textAlign: "start",
              color: "inherit",
            }}
          >
            <span className="um-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.hue }} />#{c.id}
            </span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{linkSummary(c.links)}</span>
              <span style={{ fontSize: 11, color: "var(--um-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.size} accounts · {c.counts.granted} granted · {c.counts.withheld} withheld
              </span>
            </span>
            <StateBar cluster={c} height={6} />
            <span style={{ color: "var(--um-faint)" }}>›</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function TimelineCard({
  hidden,
  timeline,
  onSelect,
}: {
  readonly hidden: boolean
  readonly timeline: Timeline
  readonly onSelect: (id: string) => void
}) {
  return (
    <div
      data-hud="1"
      className={`um-glass um-fade ${hidden ? "um-hidden" : ""}`}
      style={{ position: "absolute", bottom: 16, right: 16, left: 432, maxWidth: 760, borderRadius: 16, padding: "10px 18px", display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>Sign-up timeline</span>
        <span style={{ fontSize: 12, color: "var(--um-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{timeline.title}</span>
      </div>
      <div dir="ltr" style={{ position: "relative", height: 44, margin: "0 8px" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 15, height: 4, borderRadius: 2, background: "var(--um-line)" }} />
        <div style={{ position: "absolute", left: 0, width: "100%", top: 15, height: 4, borderRadius: 2, background: "linear-gradient(90deg,#c9d7f6,#3b6fe0)", opacity: 0.45 }} />
        {timeline.dots.map((d) => (
          <button
            key={d.id}
            type="button"
            title={d.title}
            aria-label={d.title}
            onClick={() => onSelect(d.id)}
            style={{
              position: "absolute",
              left: `${d.pos}%`,
              top: 17 - d.size / 2,
              width: d.size,
              height: d.size,
              marginLeft: -d.size / 2,
              padding: 0,
              borderRadius: "50%",
              background: d.color,
              border: "2px solid var(--um-surface)",
              boxShadow: d.selected ? "0 0 0 3px #3b6fe0" : "0 1px 3px rgba(30,40,70,.25)",
              cursor: "pointer",
            }}
          />
        ))}
        {timeline.ticks.map((t, i) => (
          <div
            key={i}
            className="um-mono"
            style={{ position: "absolute", left: `${t.pos}%`, top: 30, transform: "translateX(-50%)", fontSize: 11, color: "var(--um-muted)", whiteSpace: "nowrap" }}
          >
            {t.label}
          </div>
        ))}
      </div>
    </div>
  )
}
