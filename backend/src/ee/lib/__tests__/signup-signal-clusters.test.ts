import { describe, it, expect } from "vitest"
import {
  buildClusters,
  chunk,
  isMissingFunctionError,
  keyToken,
  KEY_TOKEN_LENGTH,
  mergeRelated,
  uniqueIds,
  RELATED_MAX,
  type ClusterRow,
  type ProfileRow,
  type SignalRow,
} from "../signup-signal-clusters.js"

const SECRET = "test-service-role-key"

const U1 = "00000000-0000-4000-8000-000000000001"
const U2 = "00000000-0000-4000-8000-000000000002"
const U3 = "00000000-0000-4000-8000-000000000003"

function row(over: Partial<ClusterRow> = {}): ClusterRow {
  return {
    cluster_key: "a".repeat(64),
    member_count: 2,
    first_seen_at: "2026-09-01T10:00:00.000Z",
    last_seen_at: "2026-09-02T08:00:00.000Z",
    user_ids: [U1, U2],
    total_count: 1,
    ...over,
  }
}

function profile(id: string, over: Partial<ProfileRow> = {}): ProfileRow {
  return { id, email: `${id}@x.test`, full_name: "A", subscription_credits: 0, free_grant_state: "withheld", ...over }
}

describe("chunk", () => {
  it("splits into runs of at most `size` and leaves the input alone", () => {
    expect(chunk([], 3)).toEqual([])
    const input = [1, 2, 3, 4, 5]
    expect(chunk(input, 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(input).toEqual([1, 2, 3, 4, 5])
  })
})

describe("keyToken", () => {
  it("is a keyed digest, never the head of the hash it was given", () => {
    const ipHash = "b".repeat(64)
    const token = keyToken(ipHash, SECRET)!
    // The regression: `ip_hash` is an UNSALTED sha256 of an IPv4, so 12 hex
    // characters of it invert to the address by brute force over 2^32.
    expect(token).not.toBe(ipHash.slice(0, KEY_TOKEN_LENGTH))
    expect(ipHash.startsWith(token)).toBe(false)
    expect(token).toMatch(/^[0-9a-f]{12}$/)
  })

  it("renders the same token for the same key, so the UI can still group by it", () => {
    expect(keyToken("b".repeat(64), SECRET)).toBe(keyToken("b".repeat(64), SECRET))
    expect(keyToken("b".repeat(64), SECRET)).not.toBe(keyToken("c".repeat(64), SECRET))
  })

  it("needs the key: a different secret is a different token", () => {
    expect(keyToken("b".repeat(64), SECRET)).not.toBe(keyToken("b".repeat(64), "another-secret"))
  })

  it("has nothing to say about an absent key", () => {
    expect(keyToken(null, SECRET)).toBeNull()
    expect(keyToken("", SECRET)).toBeNull()
    expect(keyToken(undefined, SECRET)).toBeNull()
  })
})

describe("uniqueIds", () => {
  it("dedupes across rows and preserves first-seen order", () => {
    expect(uniqueIds([row({ user_ids: [U1, U2] }), row({ user_ids: [U2, U3] })])).toEqual([U1, U2, U3])
  })
})

describe("isMissingFunctionError", () => {
  it("recognises only 'the function is not in the database yet'", () => {
    expect(isMissingFunctionError({ code: "PGRST202" })).toBe(true)
    expect(isMissingFunctionError({ code: "42883" })).toBe(true)
    expect(
      isMissingFunctionError({ message: "Could not find the function public.signup_signal_clusters(...)" }),
    ).toBe(true)
    expect(isMissingFunctionError({ code: "XX000", message: "boom" })).toBe(false)
    expect(isMissingFunctionError(null)).toBe(false)
    expect(isMissingFunctionError("PGRST202")).toBe(false)
  })
})

describe("buildClusters", () => {
  it("still lists a member whose profile row is gone", () => {
    const [cluster] = buildClusters(
      [row()],
      new Map([[U1, profile(U1)]]),
      new Map<string, SignalRow>(),
      SECRET,
    )
    expect(cluster.members).toHaveLength(2)
    const ghost = cluster.members.find((m) => m.userId === U2)!
    expect(ghost).toMatchObject({ email: null, fullName: null, state: null, subscriptionCredits: 0 })
  })

  it("orders members by signalAt ascending with the signal-less one last", () => {
    const [cluster] = buildClusters(
      [row({ user_ids: [U1, U2, U3] })],
      new Map<string, ProfileRow>(),
      new Map<string, SignalRow>([
        [U2, { user_id: U2, created_at: "2026-09-01T09:00:00.000Z", reasons: [] }],
        [U1, { user_id: U1, created_at: "2026-09-01T10:00:00.000Z", reasons: ["device_ip_match"] }],
      ]),
      SECRET,
    )
    expect(cluster.members.map((m) => m.userId)).toEqual([U2, U1, U3])
    expect(cluster.members[2].signalAt).toBeNull()
  })

  it("reports the row's true member_count even when user_ids was capped", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`)
    const [cluster] = buildClusters(
      [row({ member_count: 30, user_ids: ids })],
      new Map<string, ProfileRow>(),
      new Map<string, SignalRow>(),
      SECRET,
    )
    expect(cluster.memberCount).toBe(30)
    expect(cluster.members).toHaveLength(25)
    expect(cluster.keyPrefix).toBe(keyToken("a".repeat(64), SECRET))
    expect(cluster.keyPrefix).not.toBe("a".repeat(12))
  })
})

describe("mergeRelated", () => {
  it("lists a user once with every axis it matched on, newest signal first", () => {
    const related = mergeRelated(
      [
        { axis: "device", rows: [{ user_id: U2, created_at: "2026-09-01T09:00:00.000Z", reasons: [] }] },
        { axis: "browser", rows: [] },
        {
          axis: "ip",
          rows: [
            { user_id: U2, created_at: "2026-09-01T09:00:00.000Z", reasons: [] },
            { user_id: U3, created_at: "2026-09-01T08:00:00.000Z", reasons: ["ip_velocity"] },
          ],
        },
      ],
      new Map([[U2, profile(U2)]]),
    )
    expect(related.map((r) => r.userId)).toEqual([U2, U3])
    expect(related[0].matches).toEqual(["device", "ip"])
    expect(related[1].matches).toEqual(["ip"])
    expect(related[1].email).toBeNull()
    expect(related[1].reasons).toEqual(["ip_velocity"])
  })

  it("truncates past RELATED_MAX distinct users", () => {
    const rows: SignalRow[] = Array.from({ length: RELATED_MAX + 25 }, (_, i) => ({
      user_id: `user-${String(i).padStart(4, "0")}`,
      created_at: `2026-09-01T10:00:${String(i % 60).padStart(2, "0")}.000Z`,
      reasons: null,
    }))
    expect(mergeRelated([{ axis: "ip", rows }], new Map<string, ProfileRow>())).toHaveLength(RELATED_MAX)
  })
})
