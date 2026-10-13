import { describe, expect, it } from "vitest"
import { accountState, buildMapModel, clusterVisible, firedLinks, focusForQuery, freshnessOf, matchesQuery, opacityOf } from "../map-model"
import { clusterZoom, deskShape, layoutFloor, footprint } from "../floor-layout"
import { layoutLabels } from "../label-layout"
import { buildTimeline } from "../timeline-model"
import type { MapAccount, MapCluster, UsersMapResponse } from "../types"

const acct = (userId: string, over: Partial<MapAccount> = {}): MapAccount => ({
  userId,
  email: `${userId}@example.test`,
  state: "withheld",
  role: "user",
  createdAt: "2026-10-10T10:00:00.000Z",
  keys: null,
  ...over,
})

const cluster = (over: Partial<MapCluster> = {}): MapCluster => ({
  key: "k1",
  id: 1,
  size: 3,
  firstSeenAt: "2026-10-10T10:00:00.000Z",
  lastSeenAt: "2026-10-10T12:00:00.000Z",
  keys: [
    { axis: "device", token: "dev1", count: 2 },
    { axis: "ip", token: "net1", count: 3 },
  ],
  members: [],
  hidden: 0,
  ...over,
})

describe("account state and links", () => {
  it("shows a blocked account as blocked whatever its grant, and a missing grant as not claimed", () => {
    expect(accountState(acct("a", { state: "granted" }), new Set(["a"]))).toBe("blocked")
    expect(accountState(acct("a", { state: "revoked" }), new Set())).toBe("revoked")
    expect(accountState(acct("a", { state: "unclaimed" }), new Set())).toBe("unclaimed")
    expect(accountState(acct("a", { state: null }), new Set())).toBe("unclaimed")
  })

  it("fires a link only where the account's own key is one of the cluster's keys on that axis", () => {
    const c = cluster()
    expect(firedLinks(acct("a", { keys: { device: "dev1", browser: "b9", ip: "net1" } }), c)).toEqual(["device", "network"])
    expect(firedLinks(acct("a", { keys: { device: "other", browser: null, ip: "net1" } }), c)).toEqual(["network"])
    // A token equal to another axis's key does not fire.
    expect(firedLinks(acct("a", { keys: { device: "net1", browser: null, ip: null } }), c)).toEqual([])
    expect(firedLinks(acct("a", { keys: null }), c)).toEqual([])
  })

  it("builds activity from the busy list first, then who is online", () => {
    const data: UsersMapResponse = {
      unavailable: false,
      partial: false,
      clusters: [cluster({ members: [acct("a"), acct("b")] })],
      singles: [acct("c", { state: "granted" })],
      generating: ["a"],
    }
    const model = buildMapModel(data, new Set(), new Set(["a", "b"]))
    expect(model.byId.get("a")!.act).toBe("generating")
    expect(model.byId.get("b")!.act).toBe("online")
    expect(model.byId.get("c")!.act).toBe("offline")
    expect(model.byId.get("c")!.cluster).toBeNull()
    expect(model.clusters[0]!.links).toEqual(["device", "network"])
    expect(model.clusters[0]!.counts.withheld).toBe(2)
  })
})

describe("filters and dimming", () => {
  const data: UsersMapResponse = {
    unavailable: false,
    partial: false,
    clusters: [cluster({ members: [acct("a", { keys: { device: "dev1", browser: null, ip: null } }), acct("b")] })],
    singles: [acct("c")],
    generating: [],
  }
  const model = buildMapModel(data, new Set(["b"]), new Set())
  const ctx = { selectedCluster: null, link: null, query: "", show: "all" as const, clusterByKey: model.clusterByKey }

  it("finds by email, id or #cluster number", () => {
    const a = model.byId.get("a")!
    const c = model.clusters[0]!
    expect(matchesQuery(a, c, "A@EXAMPLE")).toBe(true)
    expect(matchesQuery(a, c, "#1")).toBe(true)
    expect(matchesQuery(a, c, "1")).toBe(true)
    expect(matchesQuery(a, c, "#12")).toBe(false)
  })

  it("dims what does not match, never to zero", () => {
    expect(opacityOf(model.byId.get("a")!, ctx)).toBe(1)
    expect(opacityOf(model.byId.get("b")!, { ...ctx, link: "device" })).toBe(0.3)
    expect(opacityOf(model.byId.get("c")!, { ...ctx, selectedCluster: "k1" })).toBe(0.5)
    expect(opacityOf(model.byId.get("a")!, { ...ctx, query: "nobody" })).toBe(0.22)
    expect(opacityOf(model.byId.get("a")!, { ...ctx, show: "blocked" })).toBe(0.3)
  })

  it("shows a cluster under Blocked only when it holds a blocked account", () => {
    expect(clusterVisible(model.clusters[0]!, "blocked")).toBe(true)
    expect(clusterVisible({ ...model.clusters[0]!, members: [model.byId.get("a")!] }, "blocked")).toBe(false)
    expect(clusterVisible(model.clusters[0]!, "legit")).toBe(false)
  })

  it("a search flies to the one account it names, or the one cluster every hit sits in, else nowhere", () => {
    expect(focusForQuery(model, "a@example")).toEqual({ type: "account", id: "a" })
    expect(focusForQuery(model, "#1")).toEqual({ type: "cluster", key: "k1" })
    // Every member's address ends the same way: the cluster, not the first hit.
    expect(focusForQuery(model, "example.test")).toBeNull() // the single desk matches too — several desks
    expect(focusForQuery(model, "nobody")).toBeNull()
    expect(focusForQuery(model, "   ")).toBeNull()
  })

  it("a quietly stopped account is marked whatever its grant state, and only when it is on the list", () => {
    const quiet = buildMapModel(data, new Set(["b"]), new Set(), new Set(["a", "b"]))
    expect(quiet.byId.get("a")!.quiet).toBe(true)
    expect(quiet.byId.get("a")!.state).toBe("withheld")
    expect(quiet.byId.get("b")!.quiet).toBe(true)
    expect(quiet.byId.get("b")!.state).toBe("blocked")
    expect(quiet.byId.get("c")!.quiet).toBe(false)
    expect(model.byId.get("a")!.quiet).toBe(false)
  })

  it("a sign-up is fresh for an hour, fading as it ages", () => {
    const now = Date.parse("2026-10-13T10:00:00.000Z")
    expect(freshnessOf(now, now)).toBe(1)
    expect(freshnessOf(now - 30 * 60_000, now)).toBeCloseTo(0.5)
    expect(freshnessOf(now - 60 * 60_000, now)).toBe(0)
    expect(freshnessOf(now + 5_000, now)).toBe(1)
    expect(freshnessOf(null, now)).toBe(0)
  })
})

describe("floor layout", () => {
  it("shapes the desk: one row up to five, two rows to twelve, nine a row past that", () => {
    expect(deskShape(4)).toMatchObject({ per: 4, rows: 1 })
    expect(deskShape(10)).toMatchObject({ per: 5, rows: 2 })
    expect(deskShape(36)).toMatchObject({ per: 9, rows: 4 })
    expect(deskShape(2).r).toBe(2.8)
  })

  it("never lets two clusters' footprints overlap, and puts the single desks past them", () => {
    const clusters = Array.from({ length: 14 }, (_, i) => ({ key: `k${i}`, drawn: [36, 20, 9, 5, 3, 2][i % 6]! }))
    const layout = layoutFloor(clusters, 30)
    const placed = clusters.map((c) => ({ ...layout.clusters.get(c.key)!, R: footprint(c.drawn) }))
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!
        const b = placed[j]!
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(a.R + b.R - 1e-9)
      }
    const deepest = Math.max(...placed.map((p) => p.z + p.R))
    expect(layout.singles.z0).toBeGreaterThan(deepest)
    expect(layout.bounds.maxZ).toBeGreaterThan(layout.singles.z0)
  })

  it("flies to a zoom that frames the desk, clamped", () => {
    expect(clusterZoom(2.8)).toBe(3.2)
    expect(clusterZoom(40)).toBe(1.3)
  })
})

describe("label layout", () => {
  it("keeps labels apart and off the HUD, hides one with no room, and always shows the selected one", () => {
    const items = [
      { x: 200, y: 200, w: 120, h: 24, selected: false },
      { x: 205, y: 200, w: 120, h: 24, selected: false },
    ]
    const out = layoutLabels(items, [], 800, 600)
    expect(out.every((o) => o.visible)).toBe(true)
    const [a, b] = out
    const apart = a!.top + 24 <= b!.top || b!.top + 24 <= a!.top || a!.left + 120 <= b!.left || b!.left + 120 <= a!.left
    expect(apart).toBe(true)
    expect(out.filter((o) => o.atAnchor)).toHaveLength(1)

    const hud = { l: 0, t: 0, r: 800, b: 600 }
    expect(layoutLabels([{ x: 200, y: 200, w: 120, h: 24, selected: false }], [hud], 800, 600)[0]!.visible).toBe(false)
    expect(layoutLabels([{ x: 200, y: 200, w: 120, h: 24, selected: true }], [hud], 800, 600)[0]!.visible).toBe(true)
  })
})

describe("timeline", () => {
  it("rescales to the selected cluster and marks its first sign-up", () => {
    const data: UsersMapResponse = {
      unavailable: false,
      partial: false,
      clusters: [
        cluster({
          members: [
            acct("a", { createdAt: "2026-10-10T10:00:00.000Z" }),
            acct("b", { createdAt: "2026-10-10T10:05:00.000Z" }),
            acct("c", { createdAt: null }),
          ],
        }),
      ],
      singles: [acct("d", { createdAt: "2026-09-01T00:00:00.000Z" })],
      generating: [],
    }
    const model = buildMapModel(data, new Set(), new Set())
    const all = buildTimeline(model.accounts, null, null)
    expect(all.dots).toHaveLength(3)
    const one = buildTimeline(model.accounts, model.clusters[0]!, "b")
    expect(one.title).toBe("#1 · 2 sign-ups in 5 minutes")
    expect(one.dots.find((d) => d.id === "a")!.size).toBe(14)
    expect(one.dots.find((d) => d.id === "b")!.selected).toBe(true)
    expect(one.ticks).toHaveLength(5)
    for (const d of one.dots) expect(d.pos).toBeGreaterThan(0)
  })
})
