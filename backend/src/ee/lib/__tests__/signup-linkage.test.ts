import { describe, it, expect } from "vitest"
import { buildLinkage, sizeTier, type AxisClusterRow, type UserSignalRow } from "../signup-linkage.js"

/**
 * Linked-account clusters for the Users page: one component per set of
 * accounts joined by ANY shared signup key (device, browser profile, network).
 *
 * Pinned here: the three axes union into one cluster; numbering is by size
 * and then deterministic (an admin's "#3" must still be the same cluster
 * sixty seconds later); the RPC's 25-id cap cannot hide a row that is on
 * screen; a unique key never makes a cluster of one.
 */

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const row = (axis: AxisClusterRow["axis"], key: string, ids: readonly string[], extra: Partial<AxisClusterRow> = {}): AxisClusterRow => ({
  axis,
  key,
  memberCount: ids.length,
  firstSeenAt: "2026-10-08T05:00:00.000Z",
  lastSeenAt: "2026-10-08T13:00:00.000Z",
  userIds: [...ids],
  ...extra,
})

describe("sizeTier", () => {
  it("is large from 10, medium from 5, small below", () => {
    expect(sizeTier(18)).toBe("large")
    expect(sizeTier(10)).toBe("large")
    expect(sizeTier(9)).toBe("medium")
    expect(sizeTier(5)).toBe("medium")
    expect(sizeTier(4)).toBe("small")
    expect(sizeTier(2)).toBe("small")
  })
})

describe("buildLinkage — the three axes join into one cluster", () => {
  it("links accounts through a device key, a browser key and a network in turn", () => {
    const rows = [
      row("device", "dev-A", [u(1), u(2)]),
      row("browser", "br-B", [u(2), u(3)]),
      row("ip", "net-C", [u(3), u(4)]),
      // An unrelated pair on its own network.
      row("ip", "net-Z", [u(8), u(9)]),
    ]
    const { clusters, clusterOfUser } = buildLinkage(rows)

    expect(clusters).toHaveLength(2)
    const big = clusters[0]!
    expect(big.id).toBe(1)
    expect([...big.knownIds].sort()).toEqual([u(1), u(2), u(3), u(4)])
    expect(big.size).toBe(4)
    expect(big.unresolved).toBe(0)
    expect(big.tier).toBe("small")
    expect(big.keys.map((k) => `${k.axis}:${k.key}:${k.count}`).sort()).toEqual(["browser:br-B:2", "device:dev-A:2", "ip:net-C:2"])
    for (const id of [u(1), u(2), u(3), u(4)]) expect(clusterOfUser.get(id)).toBe(1)
    expect(clusterOfUser.get(u(8))).toBe(2)
    expect(clusterOfUser.get(u(5))).toBeUndefined()
  })

  it("takes the cluster's time span from its earliest and latest key", () => {
    const rows = [
      row("device", "dev-A", [u(1), u(2)], { firstSeenAt: "2026-10-08T07:00:00.000Z", lastSeenAt: "2026-10-08T09:00:00.000Z" }),
      row("ip", "net-C", [u(2), u(3)], { firstSeenAt: "2026-10-08T05:30:00.000Z", lastSeenAt: "2026-10-08T13:45:00.000Z" }),
    ]
    const [c] = buildLinkage(rows).clusters
    expect(c!.firstSeenAt).toBe("2026-10-08T05:30:00.000Z")
    expect(c!.lastSeenAt).toBe("2026-10-08T13:45:00.000Z")
  })
})

describe("buildLinkage — numbering is by size, then deterministic", () => {
  it("gives #1 to the largest cluster and breaks ties by first seen, then by key", () => {
    const rows = [
      row("device", "dev-late", [u(1), u(2), u(3)], { firstSeenAt: "2026-10-08T10:00:00.000Z" }),
      row("device", "dev-early", [u(4), u(5), u(6)], { firstSeenAt: "2026-10-08T06:00:00.000Z" }),
      row("ip", "net-big", [u(7), u(8), u(9), u(10)]),
    ]
    const ids = buildLinkage(rows).clusters.map((c) => [c.id, c.size, c.keys[0]!.key])
    expect(ids).toEqual([
      [1, 4, "net-big"],
      [2, 3, "dev-early"],
      [3, 3, "dev-late"],
    ])
    // The same rows in another order number the same way.
    const again = buildLinkage([...rows].reverse()).clusters.map((c) => [c.id, c.keys[0]!.key])
    expect(again).toEqual([[1, "net-big"], [2, "dev-early"], [3, "dev-late"]])
  })

  it("breaks a full tie (size and time) by the lowest key, so two identical-looking clusters cannot swap numbers", () => {
    const rows = [row("device", "dev-b", [u(1), u(2)]), row("device", "dev-a", [u(3), u(4)])]
    expect(buildLinkage(rows).clusters.map((c) => c.keys[0]!.key)).toEqual(["dev-a", "dev-b"])
  })

  it("identifies a cluster by its lowest key, which survives the renumbering a new member causes", () => {
    const rows = [
      row("device", "dev-m", [u(1), u(2)]),
      row("ip", "net-a", [u(2), u(3)]),
      row("browser", "br-z", [u(5), u(6), u(7)]),
    ]
    const before = buildLinkage(rows).clusters
    expect(before.map((c) => [c.id, c.anchorKey])).toEqual([[1, "br-z"], [2, "dev-m"]])

    // The small cluster gains two members and overtakes the other one.
    const grown = [row("device", "dev-m", [u(1), u(2), u(8), u(9)]), rows[1]!, rows[2]!]
    const after = buildLinkage(grown).clusters
    expect(after.map((c) => [c.id, c.anchorKey])).toEqual([[1, "dev-m"], [2, "br-z"]])
  })
})

describe("buildLinkage — the RPC's 25-id cap", () => {
  it("sizes a cluster by the true member count and reports the ids it cannot name", () => {
    const known = Array.from({ length: 25 }, (_, i) => u(100 + i))
    const rows = [row("device", "dev-nat", known, { memberCount: 30 })]
    const [c] = buildLinkage(rows).clusters
    expect(c!.size).toBe(30)
    expect(c!.knownIds).toHaveLength(25)
    expect(c!.unresolved).toBe(5)
    expect(c!.tier).toBe("large")
  })

  it("attaches a page row the cap hid, through its own signal keys", () => {
    const known = Array.from({ length: 25 }, (_, i) => u(100 + i))
    const rows = [row("device", "dev-nat", known, { memberCount: 30 })]
    const hidden: UserSignalRow = {
      userId: u(999),
      deviceKey: "dev-nat",
      browserKey: "br-unique",
      ipHash: "net-unique",
      decision: "withheld",
      reasons: ["device_cluster"],
      createdAt: "2026-10-08T14:00:00.000Z",
    }
    const { clusters, clusterOfUser } = buildLinkage(rows, [hidden])
    expect(clusterOfUser.get(u(999))).toBe(1)
    expect(clusters[0]!.knownIds).toContain(u(999))
    expect(clusters[0]!.size).toBe(30)
    expect(clusters[0]!.unresolved).toBe(4)
  })

  it("never makes a cluster out of a page row whose keys nobody shares", () => {
    const rows = [row("device", "dev-A", [u(1), u(2)])]
    const alone: UserSignalRow = {
      userId: u(50),
      deviceKey: "dev-only-mine",
      browserKey: "br-only-mine",
      ipHash: "net-only-mine",
      decision: "granted",
      reasons: [],
      createdAt: "2026-10-08T14:00:00.000Z",
    }
    const { clusters, clusterOfUser } = buildLinkage(rows, [alone])
    expect(clusters).toHaveLength(1)
    expect(clusterOfUser.has(u(50))).toBe(false)
  })

  it("ignores empty keys and a page row with no keys at all", () => {
    const rows = [row("ip", "", [u(1), u(2)]), row("device", "dev-A", [u(3), u(4)])]
    const keyless: UserSignalRow = { userId: u(60), deviceKey: null, browserKey: null, ipHash: "", decision: null, reasons: [], createdAt: "2026-10-08T14:00:00.000Z" }
    const { clusters, clusterOfUser } = buildLinkage(rows, [keyless])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.keys.map((k) => k.key)).toEqual(["dev-A"])
    expect(clusterOfUser.has(u(60))).toBe(false)
  })
})
