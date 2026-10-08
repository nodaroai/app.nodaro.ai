import { describe, expect, it } from "vitest"
import {
  blockReason,
  clusterSpan,
  detailSubline,
  gateLine,
  isClusterHot,
  isLinked,
  isPillHot,
  planBlock,
  rowTone,
  sharedAxes,
  sharedLabel,
  shouldDim,
  summaryLine,
  sharedText,
  visibleUsers,
} from "../linkage-model"
import type { LinkageCluster, LinkageMember, LinkageUser, UsersById } from "../types"

/**
 * The marking's rules as values: what lights up for a pointer on a row, a key
 * or a cluster; which rows a filter keeps; what the chips and lines say; who a
 * cluster block targets.
 */

const A = "00000000-0000-4000-8000-0000000000a1"
const B = "00000000-0000-4000-8000-0000000000b2"
const C = "00000000-0000-4000-8000-0000000000c3"
const D = "00000000-0000-4000-8000-0000000000d4"
const VIEWER = "00000000-0000-4000-8000-0000000000e5"

const mark = (clusterId: number | null, device: string | null, browser: string | null, ip: string | null, decision = "withheld"): LinkageUser => ({
  clusterId,
  signals: {
    device: device ? { token: device, count: 2 } : null,
    browser: browser ? { token: browser, count: 1 } : null,
    ip: ip ? { token: ip, count: 2 } : null,
  },
  decision,
  reasons: decision === "withheld" ? ["device_ip_match"] : [],
  signalAt: "2026-10-08T13:45:00.000Z",
})

// A and B share a device and a network; D has keys nobody shares; C has none.
const users: UsersById = {
  [A]: mark(1, "dev1", "br-a", "net1"),
  [B]: mark(1, "dev1", "br-b", "net1"),
  [D]: mark(null, "dev4", "br-d", "net4", "granted"),
}

const cluster: LinkageCluster = {
  key: "c1c1c1c1c1c1",
  id: 1,
  size: 3,
  unresolved: 0,
  tier: "small",
  firstSeenAt: "2026-10-08T05:30:00.000Z",
  lastSeenAt: "2026-10-08T13:45:00.000Z",
  withheld: 2,
  granted: 1,
  keys: [
    { axis: "device", token: "dev1", count: 3 },
    { axis: "ip", token: "net1", count: 2 },
  ],
}

const members: LinkageMember[] = [
  { userId: B, email: "bob@x.test", state: "withheld", role: "user" },
  { userId: A, email: "alice@x.test", state: "withheld", role: "user" },
  { userId: C, email: null, state: "granted", role: "user" },
]

describe("what a pointer links", () => {
  it("a flagged row links the rows holding the same keys, on those axes", () => {
    expect(sharedAxes({ type: "account", userId: A }, B, users)).toEqual(["device", "ip"])
    expect(sharedAxes({ type: "account", userId: A }, A, users)).toEqual([])
    expect(sharedAxes({ type: "account", userId: A }, D, users)).toEqual([])
    expect(sharedAxes({ type: "account", userId: A }, C, users)).toEqual([])
  })

  it("a key links exactly the rows holding it", () => {
    expect(sharedAxes({ type: "key", axis: "device", token: "dev1" }, B, users)).toEqual(["device"])
    expect(sharedAxes({ type: "key", axis: "browser", token: "br-a" }, B, users)).toEqual([])
  })

  it("a cluster links its members, naming only the keys somebody else holds", () => {
    const noKeys: UsersById = { ...users, [C]: { clusterId: 1, signals: null, decision: null, reasons: [], signalAt: null } }
    expect(isLinked({ type: "cluster", clusterId: 1 }, C, noKeys)).toBe(true)
    // A's browser key has a count of one: not shared, not named.
    expect(sharedAxes({ type: "cluster", clusterId: 1 }, A, noKeys)).toEqual(["device", "ip"])
    expect(isLinked({ type: "cluster", clusterId: 2 }, A, noKeys)).toBe(false)
  })

  it("words the chip", () => {
    expect(sharedLabel({ type: "account", userId: A }, ["device", "ip"])).toBe("shares device + network")
    expect(sharedLabel({ type: "cluster", clusterId: 1 }, ["browser"])).toBe("same cluster · browser")
    expect(sharedLabel({ type: "cluster", clusterId: 1 }, [])).toBe("same cluster")
  })
})

describe("what steps back", () => {
  it("dims the unlinked rows for a pointer on a flagged row, a key or a cluster — never for a clean row", () => {
    expect(shouldDim({ type: "account", userId: A }, D, users)).toBe(true)
    expect(shouldDim({ type: "account", userId: A }, B, users)).toBe(false)
    expect(shouldDim({ type: "account", userId: A }, A, users)).toBe(false)
    expect(shouldDim({ type: "account", userId: D }, A, users)).toBe(false)
    expect(shouldDim({ type: "key", axis: "device", token: "dev1" }, D, users)).toBe(true)
    expect(shouldDim({ type: "cluster", clusterId: 1 }, D, users)).toBe(true)
    expect(shouldDim(null, D, users)).toBe(false)
  })

  it("tones a row: active over linked over tint over none", () => {
    expect(rowTone(true, true, true)).toBe("active")
    expect(rowTone(true, true, false)).toBe("linked")
    expect(rowTone(true, false, false)).toBe("tint")
    expect(rowTone(false, false, false)).toBe("none")
  })
})

describe("what fills in", () => {
  it("a pill: the pointed-at key, or the key the pointed-at row holds", () => {
    expect(isPillHot({ type: "key", axis: "device", token: "dev1" }, A, "device", "dev1", users)).toBe(true)
    expect(isPillHot({ type: "account", userId: A }, B, "device", "dev1", users)).toBe(true)
    expect(isPillHot({ type: "account", userId: A }, A, "device", "dev1", users)).toBe(false)
    expect(isPillHot({ type: "cluster", clusterId: 1 }, A, "device", "dev1", users)).toBe(false)
  })

  it("a cluster pill: its own pointer, a member row, or a key one of them holds", () => {
    expect(isClusterHot({ type: "cluster", clusterId: 1 }, cluster, users)).toBe(true)
    expect(isClusterHot({ type: "account", userId: B }, cluster, users)).toBe(true)
    expect(isClusterHot({ type: "account", userId: D }, cluster, users)).toBe(false)
    expect(isClusterHot({ type: "key", axis: "browser", token: "br-a" }, cluster, users)).toBe(true)
    expect(isClusterHot({ type: "key", axis: "browser", token: "br-d" }, cluster, users)).toBe(false)
  })
})

describe("what the filters keep", () => {
  const rows = [
    { id: A, email: "alice@x.test", full_name: "Alice" },
    { id: C, email: "carol@x.test", full_name: null },
    { id: D, email: "dave@x.test", full_name: "Dave" },
  ]

  it("flagged only keeps clustered rows; a cluster keeps its members; nothing on keeps everything", () => {
    expect(visibleUsers(rows, users, { onlyFlagged: true, clusterId: null }).map((r) => r.id)).toEqual([A])
    expect(visibleUsers(rows, users, { onlyFlagged: false, clusterId: 1 }).map((r) => r.id)).toEqual([A])
    expect(visibleUsers(rows, users, { onlyFlagged: true, clusterId: 2 })).toHaveLength(0)
    expect(visibleUsers(rows, users, { onlyFlagged: false, clusterId: null })).toHaveLength(3)
  })
})

describe("what the lines say", () => {
  it("sums the summary and names the empty case", () => {
    expect(summaryLine({ clusters: 1, accounts: 3, withheld: 2, granted: 1 })).toBe("1 cluster · 3 accounts · 2 withheld · 1 granted")
    expect(summaryLine({ clusters: 0, accounts: 0, withheld: 0, granted: 0 })).toBe("No linked accounts found.")
  })

  it("spans a cluster within one day as a time range", () => {
    const span = clusterSpan(cluster)
    expect(span).toContain("–")
    expect(span.split("–")).toHaveLength(2)
    expect(detailSubline(cluster, 2)).toContain("2 withheld · 1 granted · 2 on this page")
    expect(detailSubline({ ...cluster, unresolved: 5 }, 2)).toContain("5 not listed")
  })

  it("words a key's company, and refuses to call a lone key unique after a partial walk", () => {
    expect(sharedText(1)).toBe("unique in system")
    expect(sharedText(1, true)).toBe("not checked (too many clusters)")
    expect(sharedText(2)).toBe("shared with 1 other account")
    expect(sharedText(4)).toBe("shared with 3 other accounts")
  })

  it("words the gate's decision", () => {
    expect(gateLine(users[A]!, cluster)).toMatch(/^Free credits withheld at signup · .+ · cluster #1$/)
    expect(gateLine(users[D]!, null)).toMatch(/^Free credits granted at signup — no matching signals · /)
    expect(gateLine({ clusterId: null, signals: null, decision: null, reasons: [], signalAt: null }, null)).toBe(
      "No gate decision recorded for this account.",
    )
  })
})

describe("blocking a cluster", () => {
  it("targets the unblocked members by email, leaving out admins and the viewer, whom the route refuses", () => {
    const withStaff: LinkageMember[] = [
      ...members,
      { userId: D, email: "dana@x.test", state: "granted", role: "admin" },
      { userId: VIEWER, email: "me@x.test", state: "granted", role: "user" },
    ]
    const plan = planBlock(withStaff, new Set([B]), VIEWER)
    expect(plan.targets.map((m) => m.email ?? m.userId)).toEqual([C, "alice@x.test"])
    expect(plan.alreadyBlocked).toBe(1)
    expect(plan.admins).toBe(2)
  })

  it("writes a reason that explains the block, inside the server's 500 characters", () => {
    expect(blockReason(cluster)).toBe("Linked-account cluster #1: 3 accounts sharing device dev1 (3), network net1 (2)")
    const many: LinkageCluster = {
      ...cluster,
      keys: Array.from({ length: 40 }, (_, i) => ({ axis: "ip" as const, token: `${i}`.padStart(12, "f"), count: 2 })),
    }
    expect(blockReason(many).length).toBeLessThanOrEqual(500)
  })
})
