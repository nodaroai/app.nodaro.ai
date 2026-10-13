import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { useOnlineUsers } from "@/ee/app/(admin)/admin/site-analytics/use-site-analytics"
import { layoutFloor } from "./floor-layout"
import { ClusterList, TimelineCard } from "./map-bottom"
import { ShowControls, TopRight, type Kpi, type ShowOption } from "./map-hud"
import {
  ACTIVITY,
  buildMapModel,
  clusterVisible,
  countStates,
  linkSummary,
  opacityOf,
  STATES,
  type LinkType,
  type ShowFilter,
} from "./map-model"
import { AccountPanel, ClusterPanel } from "./map-side-panel"
import { buildTimeline } from "./timeline-model"
import { useUsersMap } from "./use-users-map"
import type { Pick } from "./world/world-builders"
import type { World, WorldView } from "./world/create-world"
import "./users-map.css"

/**
 * The Users page's map mode: every linked-account cluster as one person at a
 * desk with a screen per account, the newest unlinked accounts at single
 * desks, who is online and who is generating now. The table stays the
 * complete view; this is the picture of it.
 */

const PANEL_WIDTH = 380
const PANEL_OFFSET = 396

export default function UsersMapView({
  query,
  blockedIds,
  canAct,
  viewerId,
}: {
  readonly query: string
  readonly blockedIds: ReadonlySet<string>
  readonly canAct: boolean
  readonly viewerId: string
}) {
  const { resolvedTheme } = useTheme()
  const theme = resolvedTheme === "dark" ? "dark" : "light"
  const { data, error, isLoading } = useUsersMap(true)
  const online = useOnlineUsers(true)
  const onlineIds = useMemo(() => new Set((online.data?.users ?? []).map((u) => u.userId)), [online.data])

  const [selected, setSelectedRaw] = useState<Pick | null>(null)
  // A bulk run in the side panel holds the selection: leaving it would stop the run mid-way.
  const [bulkRunning, setBulkRunning] = useState(false)
  const running = useRef(false)
  running.current = bulkRunning
  const setSelected = useCallback((pick: Pick | null) => {
    if (!running.current) setSelectedRaw(pick)
  }, [])
  const [show, setShow] = useState<ShowFilter>("all")
  const [link, setLink] = useState<LinkType | null>(null)
  const [clean, setClean] = useState(false)
  const [world, setWorld] = useState<World | null>(null)
  const [worldError, setWorldError] = useState<string | null>(null)
  const host = useRef<HTMLDivElement | null>(null)

  const model = useMemo(() => (data && !data.unavailable ? buildMapModel(data, blockedIds, onlineIds) : null), [data, blockedIds, onlineIds])
  const layout = useMemo(
    () => (model ? layoutFloor(model.clusters.map((c) => ({ key: c.key, drawn: c.members.length })), model.singles.length) : null),
    [model],
  )

  const selectedAccount = selected?.type === "account" ? (model?.byId.get(selected.id) ?? null) : null
  const selectedCluster =
    selected?.type === "cluster"
      ? (model?.clusterByKey.get(selected.key) ?? null)
      : selectedAccount?.cluster
        ? (model?.clusterByKey.get(selectedAccount.cluster) ?? null)
        : null

  // The world loads with three.js only when the map opens: the table never pays for it.
  useEffect(() => {
    const el = host.current
    if (!el) return
    let made: World | null = null
    let cancelled = false
    import("./world/create-world")
      .then((mod) => {
        if (cancelled) return
        made = mod.createWorld(el, (pick) => setSelected(pick))
        setWorld(made)
      })
      .catch((err: unknown) => setWorldError(err instanceof Error ? err.message : "The 3D view could not start"))
    return () => {
      cancelled = true
      made?.dispose()
      setWorld(null)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return
      if (e.key === "h" || e.key === "H") setClean((c) => !c)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // A selection that left the data (a refresh moved it) is dropped, not left dangling.
  useEffect(() => {
    if (!model || !selected) return
    const gone = selected.type === "cluster" ? !model.clusterByKey.has(selected.key) : !model.byId.has(selected.id)
    if (gone) setSelected(null)
  }, [model, selected, setSelected])

  const panelOpen = selectedAccount !== null || (selected?.type === "cluster" && selectedCluster !== null)

  useEffect(() => {
    if (!world || !model || !layout) return
    const ctx = { selectedCluster: selectedCluster?.key ?? null, link, query, show, clusterByKey: model.clusterByKey }
    const view: WorldView = {
      theme,
      show,
      labels: !clean,
      layout,
      clusters: model.clusters.map((c) => ({
        key: c.key,
        id: c.id,
        hue: c.hue,
        links: c.links,
        size: c.size,
        granted: c.counts.granted,
        withheld: c.counts.withheld,
        visible: clusterVisible(c, show),
      })),
      accounts: model.accounts.map((a) => {
        const cluster = a.cluster ? model.clusterByKey.get(a.cluster) : undefined
        return {
          id: a.id,
          cluster: a.cluster,
          state: a.state,
          act: a.act,
          fired: a.fired,
          email: a.email,
          op: opacityOf(a, ctx),
          stateLabel: STATES[a.state].label,
          actLabel: ACTIVITY[a.act].label,
          why: cluster ? `#${cluster.id}${a.fired.length ? ` · ${linkSummary(a.fired)}` : ""}` : "",
        }
      }),
      selected,
      selectedCluster: selectedCluster?.key ?? null,
      link,
      panelOffset: panelOpen ? PANEL_OFFSET : 0,
    }
    world.update(view)
  }, [world, model, layout, theme, show, clean, selected, selectedCluster, link, query, panelOpen])

  const counts = useMemo(() => countStates(model?.accounts ?? []), [model])
  const kpis: Kpi[] = model
    ? [
        { label: "Gift granted", value: counts.granted, sub: "Received the free credits", color: STATES.granted.dot },
        { label: "Withheld", value: counts.withheld, sub: "A purchase unlocks", color: STATES.withheld.dot },
        { label: "Blocked", value: counts.blocked, sub: "By an admin", color: STATES.blocked.dot },
        {
          label: "Online now",
          value: model.accounts.filter((a) => a.act !== "offline").length,
          sub: `${model.accounts.filter((a) => a.act === "generating").length} generating`,
          color: "#3b6fe0",
        },
      ]
    : []
  const showOptions: ShowOption[] = model
    ? [
        { key: "all", label: "All", dot: "#c3cad8", count: model.accounts.length },
        { key: "suspects", label: "Suspicious", dot: "#e8743b", count: model.accounts.length - model.singles.length },
        { key: "legit", label: "Unlinked", dot: "#3fb36b", count: model.singles.length },
        { key: "blocked", label: "Blocked", dot: STATES.blocked.dot, count: counts.blocked },
      ]
    : []
  const timeline = useMemo(
    () => buildTimeline(model?.accounts ?? [], selectedCluster, selectedAccount?.id ?? null),
    [model, selectedCluster, selectedAccount],
  )
  const left = panelOpen ? 16 + PANEL_WIDTH + 16 : 16
  const message = worldError ?? error?.message ?? (data?.unavailable ? "Linked-account clusters are not available on this database yet." : isLoading || !world ? "Loading map…" : null)

  return (
    <div className="users-map" dir="ltr" style={{ height: "calc(100dvh - 120px)", minHeight: 560, borderRadius: 12, border: "1px solid var(--um-line)" }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {message && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--um-muted)", fontSize: 14, pointerEvents: "none" }}>{message}</div>
      )}
      {model && (
        <>
          <ShowControls
            left={left}
            options={showOptions}
            show={show}
            onShow={(s) => {
              if (running.current) return
              setShow(s)
              setSelected(null)
            }}
            clean={clean}
            onClean={() => setClean((c) => !c)}
            controls={[
              { icon: "+", title: "Zoom in", onClick: () => world?.zoomBy(1.15) },
              { icon: "−", title: "Zoom out", onClick: () => world?.zoomBy(1 / 1.15) },
              { icon: "↺", title: "Rotate left", onClick: () => world?.rotateBy(Math.PI / 4) },
              { icon: "↻", title: "Rotate right", onClick: () => world?.rotateBy(-Math.PI / 4) },
              {
                icon: "⌂",
                title: "Overview",
                onClick: () => {
                  setSelected(null)
                  world?.home()
                },
              },
            ]}
          />
          <TopRight hidden={clean} kpis={kpis} link={link} onLink={setLink} />
          <ClusterList
            hidden={clean}
            clusters={model.clusters}
            selected={selectedCluster?.key ?? null}
            onSelect={(key) => setSelected({ type: "cluster", key })}
            partial={data?.partial ?? false}
          />
          <TimelineCard hidden={clean} timeline={timeline} onSelect={(id) => setSelected({ type: "account", id })} />
        </>
      )}
      {model && panelOpen && (
        <aside
          data-hud="1"
          className="um-glass"
          style={{ position: "absolute", top: 16, left: 16, width: PANEL_WIDTH, bottom: 250, overflowY: "auto", borderRadius: 16, display: "flex", flexDirection: "column", zIndex: 3 }}
        >
          {selectedAccount ? (
            <AccountPanel
              account={selectedAccount}
              cluster={selectedCluster}
              canAct={canAct}
              viewerId={viewerId}
              onCluster={(key) => setSelected({ type: "cluster", key })}
              onClose={() => setSelected(null)}
            />
          ) : (
            selectedCluster && (
              <ClusterPanel
                key={selectedCluster.key}
                onRunningChange={setBulkRunning}
                cluster={selectedCluster}
                canAct={canAct}
                blockedIds={blockedIds}
                viewerId={viewerId}
                onAccount={(id) => setSelected({ type: "account", id })}
                onClose={() => setSelected(null)}
              />
            )
          )}
        </aside>
      )}
    </div>
  )
}
