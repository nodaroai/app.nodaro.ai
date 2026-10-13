import type { CSSProperties, ReactNode } from "react"
import { LINKS, STATE_KEYS, STATES, type AccountState, type LinkType, type ShowFilter } from "./map-model"

/**
 * The floating cards over the floor: the show filter and clean-view toggle,
 * the zoom and rotate column, the numbers, and the link / state legend. Each
 * card carries `data-hud` so the in-world labels keep clear of it.
 */

const seg = (on: boolean): CSSProperties => ({
  border: 0,
  cursor: "pointer",
  padding: "6px 10px",
  borderRadius: 9,
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: "nowrap",
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: on ? "var(--um-seg)" : "transparent",
  color: on ? "var(--um-ink)" : "var(--um-text2)",
  boxShadow: on ? "0 1px 4px rgba(30,40,70,.15)" : "none",
})

const dot = (color: string, size = 7, radius: number | string = "50%"): CSSProperties => ({
  width: size,
  height: size,
  borderRadius: radius,
  background: color,
  flexShrink: 0,
})

export interface ShowOption {
  readonly key: ShowFilter
  readonly label: string
  readonly dot: string
  readonly count: number
}

export function ShowControls({
  left,
  options,
  show,
  onShow,
  clean,
  onClean,
  controls,
}: {
  readonly left: number
  readonly options: readonly ShowOption[]
  readonly show: ShowFilter
  readonly onShow: (s: ShowFilter) => void
  readonly clean: boolean
  readonly onClean: () => void
  readonly controls: ReadonlyArray<{ readonly icon: string; readonly title: string; readonly onClick: () => void }>
}) {
  return (
    <>
      <div data-hud="1" style={{ position: "absolute", top: 16, left, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", zIndex: 2 }}>
        <div className="um-glass" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 12 }}>
          {options.map((o) => (
            <button key={o.key} type="button" style={seg(show === o.key)} onClick={() => onShow(o.key)}>
              <span style={dot(o.dot)} />
              {o.label}
              <span className="um-mono" style={{ fontSize: 11, opacity: 0.6 }}>
                {o.count}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          title="Shortcut: H"
          aria-pressed={clean}
          onClick={onClean}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            height: 36,
            padding: "0 11px",
            borderRadius: 12,
            border: `1px solid ${clean ? "var(--um-ink)" : "var(--um-line)"}`,
            background: clean ? "var(--um-ink)" : "var(--um-surface)",
            color: clean ? "var(--um-surface)" : "inherit",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: "nowrap",
            boxShadow: "var(--um-shadow)",
          }}
        >
          <span style={{ width: 12, height: 9, borderRadius: 2, border: "1.5px solid currentColor" }} />
          Clean view
        </button>
      </div>
      <div data-hud="1" className="um-glass" style={{ position: "absolute", top: 108, left, display: "flex", flexDirection: "column", gap: 2, padding: 4, borderRadius: 12, zIndex: 2 }}>
        {controls.map((c) => (
          <button
            key={c.title + c.icon}
            type="button"
            title={c.title}
            aria-label={c.title}
            onClick={c.onClick}
            className="um-row"
            style={{ width: 34, height: 34, border: 0, borderRadius: 9, background: "transparent", cursor: "pointer", fontSize: 18, color: "var(--um-text2)", display: "grid", placeItems: "center" }}
          >
            {c.icon}
          </button>
        ))}
      </div>
    </>
  )
}

export interface Kpi {
  readonly label: string
  readonly value: number
  readonly sub: string
  readonly color: string
}

export function TopRight({
  hidden,
  kpis,
  link,
  onLink,
}: {
  readonly hidden: boolean
  readonly kpis: readonly Kpi[]
  readonly link: LinkType | null
  readonly onLink: (l: LinkType | null) => void
}) {
  return (
    <div
      data-hud="1"
      className={`um-fade ${hidden ? "um-hidden" : ""}`}
      style={{ position: "absolute", top: 16, right: 16, maxWidth: "calc(100% - 420px)", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}
    >
      <div className="um-glass" style={{ maxWidth: "100%", display: "flex", borderRadius: 14, padding: 4 }}>
        {kpis.map((k, i) => (
          <div
            key={k.label}
            style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 2, padding: "8px 14px", borderInlineStart: i ? "1px solid var(--um-line)" : "none" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--um-text2)", whiteSpace: "nowrap" }}>
              <span style={dot(k.color, 8, 2)} />
              {k.label}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="um-mono" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1, letterSpacing: "-.02em" }}>
                {k.value.toLocaleString("en-US")}
              </span>
              <span style={{ fontSize: 11, color: "var(--um-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{k.sub}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="um-glass" style={{ maxWidth: "100%", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", padding: 4, borderRadius: 12 }}>
        <span style={{ fontSize: 12, color: "var(--um-muted)", padding: "0 6px", whiteSpace: "nowrap" }}>Link type</span>
        {LINKS.map((l) => {
          const on = link === l.key
          return (
            <button
              key={l.key}
              type="button"
              aria-pressed={on}
              onClick={() => onLink(on ? null : l.key)}
              className={on ? "" : "um-row"}
              style={{ display: "flex", alignItems: "center", gap: 8, border: 0, cursor: "pointer", padding: "6px 10px", borderRadius: 9, fontSize: 12, whiteSpace: "nowrap", background: on ? "var(--um-ink)" : "transparent", color: on ? "var(--um-surface)" : "inherit" }}
            >
              <span style={{ width: 22, height: 0, borderTop: `${l.border} ${on ? "var(--um-surface)" : l.color}` }} />
              {l.short}
            </button>
          )
        })}
        <Divider />
        {STATE_KEYS.map((s: AccountState) => (
          <Legend key={s} swatch={{ ...dot(STATES[s].dot, 12, 2), height: 8 }}>
            {STATES[s].label}
          </Legend>
        ))}
        <Divider />
        <Legend swatch={{ ...dot("#151c2c", 12, 2), height: 8, boxShadow: "inset 0 0 0 1px var(--um-faint)" }}>Screen off · offline</Legend>
        <Legend swatch={{ width: 14, height: 4, borderRadius: 2, background: "linear-gradient(90deg,#3b6fe0 60%,#d5dbe6 60%)" }}>Generating</Legend>
      </div>
    </div>
  )
}

function Divider() {
  return <span style={{ width: 1, height: 20, background: "var(--um-line)", margin: "0 4px" }} />
}

function Legend({ swatch, children }: { readonly swatch: CSSProperties; readonly children: ReactNode }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "0 4px", whiteSpace: "nowrap" }}>
      <span style={{ height: 8, ...swatch }} />
      {children}
    </span>
  )
}
