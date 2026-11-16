import { describe, it, expect, vi, beforeEach } from "vitest"

// Table-keyed stub: every query on a table resolves that table's staged rows
// (filters are ignored — the module re-checks windows and statuses in JS, so
// the staging below is exactly the honesty the production path also has).
// Count queries (`head: true`) resolve the staged `counts` entry. A column in
// `missingColumns` fails every select that names it, as a database without
// that column does.
const state = {
  tables: {} as Record<string, unknown[]>,
  counts: {} as Record<string, { count: number | null; error: unknown }>,
  errors: {} as Record<string, unknown>,
  missingColumns: [] as string[],
}

vi.mock("@/lib/supabase.js", () => {
  const from = vi.fn((table: string) => {
    let head = false
    let missing: string | undefined
    const chain: Record<string, unknown> = {}
    for (const m of ["eq", "not", "gt", "gte", "lt", "lte", "in", "order", "limit", "range"]) {
      chain[m] = vi.fn(() => chain)
    }
    chain.select = vi.fn((cols: string, opts?: { head?: boolean }) => {
      head = Boolean(opts?.head)
      missing = state.missingColumns.find((c) => cols.includes(c))
      return chain
    })
    chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      const out = missing
        ? { data: null, error: { code: "42703", message: `column profiles.${missing} does not exist` } }
        : head
        ? { data: null, ...(state.counts[table] ?? { count: null, error: null }) }
        : { data: state.tables[table] ?? [], error: state.errors[table] ?? null }
      return Promise.resolve(out).then(resolve, reject)
    }
    return chain
  })
  return { supabase: { from } }
})

const notifyState = { cursor: null as string | null }
vi.mock("@/ee/notifications/notify-config.js", () => ({
  readNotifyState: vi.fn(async () => notifyState.cursor),
  writeNotifyState: vi.fn(async (_k: string, v: string) => {
    notifyState.cursor = v
  }),
}))
vi.mock("@/ee/notifications/signup-product.js", () => ({
  signupProduct: vi.fn(async () => "app"),
}))

import { pollWelcomeOffer, humaniseDelta, welcomeLabel, welcomeLabelsFor, countSubscribed, SHOWING_SETTLE_MS } from "../welcome-offer-notify.js"
import { writeNotifyState } from "../notify-config.js"

const CURSOR = "2026-09-16T08:00:00.000Z"
const NOW = new Date("2026-09-16T08:05:00.000Z")
const SIGNUP = "2026-09-14T03:55:00.000Z" // 2d 4h 10m before an accept at 08:05

const profile = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  email: "ada@example.com",
  role: "user",
  created_at: SIGNUP,
  welcome_offer_seen_at: null,
  free_grant_state: "granted",
  welcome_offer_declined_at: null,
  welcome_offer_shown_count: 0,
  welcome_offer_last_shown_at: null,
  ...over,
})
const NEW_COLUMNS = ["welcome_offer_declined_at", "welcome_offer_shown_count", "welcome_offer_last_shown_at"]
const consent = (over: Record<string, unknown> = {}) => ({
  user_id: "u1",
  status: "granted",
  granted_at: "2026-09-16T08:03:00.000Z",
  declined_at: null,
  withdrawn_at: null,
  source_app: "studio",
  ...over,
})

let posted: string[]
const post = vi.fn(async (msg: { text: string }) => {
  posted.push(msg.text)
  return true
})

beforeEach(() => {
  vi.clearAllMocks()
  posted = []
  state.tables = {}
  state.counts = {}
  state.errors = {}
  state.missingColumns = []
  notifyState.cursor = CURSOR
})

describe("humaniseDelta", () => {
  it("reads minutes, hours, and days with a remainder", () => {
    expect(humaniseDelta(2 * 60_000)).toBe("2m")
    expect(humaniseDelta(3 * 3_600_000)).toBe("3h")
    expect(humaniseDelta((2 * 24 + 4) * 3_600_000 + 10 * 60_000)).toBe("2d 4h")
    expect(humaniseDelta(3 * 24 * 3_600_000)).toBe("3d")
  })
})

describe("pollWelcomeOffer — cursor", () => {
  it("initialises the cursor to now and posts nothing on the first tick", async () => {
    notifyState.cursor = null
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile()]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
    expect(writeNotifyState).toHaveBeenCalledWith("notify_welcome_cursor", NOW.toISOString())
  })

  it("advances the cursor while disabled without posting", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile()]
    await pollWelcomeOffer(NOW, false, post)
    expect(post).not.toHaveBeenCalled()
    expect(writeNotifyState).toHaveBeenCalledWith("notify_welcome_cursor", NOW.toISOString())
  })
})

describe("pollWelcomeOffer — accepted", () => {
  it("posts a plain accept with the source app and the time since signup", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile()]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toEqual([":white_check_mark: Welcome credits accepted — ada@example.com (studio) · 2d 4h after signup"])
  })

  it("says how much earlier the popup was first shown when they came back", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile({ welcome_offer_seen_at: "2026-09-14T04:03:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain("popup first shown 2d 4h earlier, came back")
  })

  it('says how much earlier they answered "Maybe later" when they came back', async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [
      profile({
        welcome_offer_seen_at: "2026-09-14T04:03:00.000Z",
        welcome_offer_declined_at: "2026-09-15T08:03:00.000Z",
        free_grant_state: "granted",
      }),
    ]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain('answered "Maybe later" 1d earlier, came back')
    expect(posted[0]).not.toContain("first shown")
  })

  it("an accept within 10 minutes of the popup is a plain accept", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile({ welcome_offer_seen_at: "2026-09-16T07:58:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).not.toContain("came back")
  })

  it("before migration 653 the accept still posts, read as before", async () => {
    state.missingColumns = NEW_COLUMNS
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile({ welcome_offer_seen_at: "2026-09-14T04:03:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain("Welcome credits accepted")
    expect(posted[0]).toContain("popup first shown 2d 4h earlier, came back")
  })

  it("flags withheld credits", async () => {
    state.tables.user_consents = [consent()]
    state.tables.profiles = [profile({ free_grant_state: "withheld" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted[0]).toContain("credits WITHHELD (shared machine)")
  })

  it("ignores a grant stamp outside the window and a non-granted row", async () => {
    state.tables.user_consents = [consent({ granted_at: "2026-09-16T07:00:00.000Z" }), consent({ user_id: "u2", status: "withdrawn" })]
    state.tables.profiles = [profile(), profile({ id: "u2", email: "bob@example.com" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
  })

  it("excludes internal accounts", async () => {
    state.tables.user_consents = [consent(), consent({ user_id: "u2" })]
    state.tables.profiles = [profile({ email: "asaf@nodaro.ai" }), profile({ id: "u2", email: "x@example.com", role: "admin" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
  })
})

describe('pollWelcomeOffer — "Maybe later"', () => {
  it("posts the answer with the time since signup and the showings it came after", async () => {
    state.tables.profiles = [
      profile({
        welcome_offer_seen_at: "2026-09-15T08:00:00.000Z",
        welcome_offer_declined_at: "2026-09-16T08:02:00.000Z",
        welcome_offer_shown_count: 2,
        welcome_offer_last_shown_at: "2026-09-16T08:01:00.000Z",
        created_at: "2026-09-15T07:00:30.000Z",
        free_grant_state: "unclaimed",
      }),
    ]
    state.tables.user_consents = []
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toEqual([':no_entry_sign: Welcome popup answered "Maybe later" — ada@example.com (app) · 1d 1h after signup · after 2 of 3 showings'])
  })

  it("an answer given before the popup ever opened by itself says so (0 showings), though it stamps first shown", async () => {
    state.tables.profiles = [
      profile({
        welcome_offer_seen_at: "2026-09-16T08:02:00.000Z",
        welcome_offer_declined_at: "2026-09-16T08:02:00.000Z",
        welcome_offer_shown_count: 0,
        created_at: "2026-09-16T08:00:00.000Z",
        free_grant_state: "unclaimed",
      }),
    ]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toEqual([':no_entry_sign: Welcome popup answered "Maybe later" — ada@example.com (app) · 2m after signup · after 0 of 3 showings'])
  })

  it("does not report the answer of a user who granted in the same window (the accept line covers it)", async () => {
    state.tables.profiles = [profile({ welcome_offer_seen_at: "2026-09-16T08:01:00.000Z", welcome_offer_declined_at: "2026-09-16T08:01:30.000Z" })]
    state.tables.user_consents = [consent({ granted_at: "2026-09-16T08:04:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain("accepted")
  })

  it("ignores an answer outside the window, and internal accounts", async () => {
    state.tables.profiles = [
      profile({ welcome_offer_declined_at: "2026-09-16T07:30:00.000Z", free_grant_state: "unclaimed" }),
      profile({ id: "u2", email: "x@nodaro.ai", welcome_offer_declined_at: "2026-09-16T08:02:00.000Z", free_grant_state: "unclaimed" }),
    ]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
  })
})

describe("pollWelcomeOffer — shown, no answer", () => {
  // The tick's window (08:00, 08:05], shifted back SHOWING_SETTLE_MS: (07:50, 07:55].
  const SETTLED = "2026-09-16T07:52:00.000Z"
  const unanswered = (over: Record<string, unknown> = {}) =>
    profile({
      welcome_offer_seen_at: SETTLED,
      welcome_offer_shown_count: 1,
      welcome_offer_last_shown_at: SETTLED,
      created_at: "2026-09-16T07:40:00.000Z",
      free_grant_state: "unclaimed",
      ...over,
    })

  it("waits ten minutes for an answer", () => {
    expect(SHOWING_SETTLE_MS).toBe(10 * 60_000)
  })

  it("posts a showing that has had no answer for ten minutes, with its number", async () => {
    state.tables.profiles = [unanswered()]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toEqual([":hourglass_flowing_sand: Welcome popup shown, no answer — ada@example.com (app) · showing 1 of 3 · 12m after signup"])
  })

  it("says so when it was the last showing", async () => {
    state.tables.profiles = [unanswered({ welcome_offer_shown_count: 3, welcome_offer_seen_at: "2026-09-14T07:52:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain("showing 3 of 3")
    expect(posted[0]).toContain("it will not open by itself again")
  })

  it("a showing too recent to judge waits for the next tick, and is posted exactly once", async () => {
    const recent = "2026-09-16T08:03:00.000Z"
    state.tables.profiles = [unanswered({ welcome_offer_seen_at: recent, welcome_offer_last_shown_at: recent })]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
    // 08:15: window (08:05, 08:15] shifted back is (07:55, 08:05] — it is in.
    await pollWelcomeOffer(new Date("2026-09-16T08:15:00.000Z"), true, post)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toContain("shown, no answer")
    // 08:25: (08:05, 08:15] — it is not posted again.
    await pollWelcomeOffer(new Date("2026-09-16T08:25:00.000Z"), true, post)
    expect(posted).toHaveLength(1)
  })

  it('a showing answered with "Maybe later" is left to that line', async () => {
    state.tables.profiles = [unanswered({ welcome_offer_declined_at: "2026-09-16T07:53:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted.some((t) => t.includes("no answer"))).toBe(false)
  })

  it("a showing followed by a claim is left to the accept line", async () => {
    state.tables.profiles = [unanswered()]
    state.tables.user_consents = [consent({ granted_at: "2026-09-16T07:54:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted.some((t) => t.includes("no answer"))).toBe(false)
  })

  it("a showing the migration backfilled from an old close is history: never posted", async () => {
    state.tables.profiles = [unanswered({ welcome_offer_seen_at: "2026-09-01T10:00:00.000Z", welcome_offer_last_shown_at: "2026-09-01T10:00:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
  })

  it("before migration 653 neither popup stream posts, and the tick still advances", async () => {
    state.missingColumns = NEW_COLUMNS
    state.tables.profiles = [unanswered({ welcome_offer_declined_at: "2026-09-16T08:02:00.000Z" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
    expect(writeNotifyState).toHaveBeenCalledWith("notify_welcome_cursor", NOW.toISOString())
  })
})

describe("pollWelcomeOffer — opt-outs", () => {
  it("posts a decline and an unsubscribe with one wording each", async () => {
    state.tables.user_consents = [
      consent({ user_id: "u1", status: "declined", granted_at: null, declined_at: "2026-09-16T08:01:00.000Z" }),
      consent({ user_id: "u2", status: "withdrawn", granted_at: null, withdrawn_at: "2026-09-16T08:02:00.000Z" }),
    ]
    state.tables.profiles = [profile(), profile({ id: "u2", email: "bob@example.com" })]
    await pollWelcomeOffer(NOW, true, post)
    expect(posted).toEqual([
      ":no_entry_sign: Marketing emails declined — ada@example.com",
      ":leftwards_arrow_with_hook: Unsubscribed from marketing emails — bob@example.com",
    ])
  })

  it("does not report a withdrawal stamp whose row has since been re-granted", async () => {
    state.tables.user_consents = [consent({ status: "granted", granted_at: "2026-09-16T07:00:00.000Z", withdrawn_at: "2026-09-16T08:02:00.000Z" })]
    state.tables.profiles = [profile()]
    await pollWelcomeOffer(NOW, true, post)
    expect(post).not.toHaveBeenCalled()
  })
})

describe("digest helpers", () => {
  it("welcomeLabel says what happened", () => {
    const shown = (n: number, declinedAt: string | null = null) => ({ declinedAt, shownCount: n, lastShownAt: "2026-09-16T08:00:00.000Z" })
    expect(welcomeLabel({ welcome_offer_seen_at: null, free_grant_state: "granted" }, consent() as never)).toBe("accepted")
    expect(welcomeLabel({ welcome_offer_seen_at: null, free_grant_state: "withheld" }, consent() as never)).toBe("accepted, withheld")
    expect(welcomeLabel({ welcome_offer_seen_at: "2026-09-16T08:00:00.000Z", free_grant_state: "unclaimed" }, undefined, shown(1, "2026-09-16T08:00:10.000Z"))).toBe("maybe later")
    expect(welcomeLabel({ welcome_offer_seen_at: "2026-09-15T08:00:00.000Z", free_grant_state: "unclaimed" }, undefined, shown(2))).toBe("no answer, shown 2 of 3")
    expect(welcomeLabel({ welcome_offer_seen_at: null, free_grant_state: "unclaimed" }, undefined, shown(0))).toBe("not shown")
    // An old close with nothing counted is one showing without an answer, as the server counts it.
    expect(welcomeLabel({ welcome_offer_seen_at: "2026-09-16T08:00:00.000Z", free_grant_state: "unclaimed" }, undefined)).toBe("no answer, shown 1 of 3")
    expect(welcomeLabel({ welcome_offer_seen_at: null, free_grant_state: "unclaimed" }, undefined)).toBe("not shown")
  })

  it("welcomeLabelsFor maps every id it can find and skips unknown ones", async () => {
    state.tables.profiles = [
      profile(),
      profile({ id: "u2", welcome_offer_seen_at: "2026-09-16T08:00:00.000Z", welcome_offer_shown_count: 1, welcome_offer_last_shown_at: "2026-09-16T08:00:00.000Z", free_grant_state: "unclaimed" }),
      profile({ id: "u4", welcome_offer_seen_at: "2026-09-16T08:00:00.000Z", welcome_offer_declined_at: "2026-09-16T08:00:05.000Z", welcome_offer_shown_count: 1, free_grant_state: "unclaimed" }),
    ]
    state.tables.user_consents = [consent()]
    const m = await welcomeLabelsFor(["u1", "u2", "u3", "u4"])
    expect(m.get("u1")).toBe("accepted")
    expect(m.get("u2")).toBe("no answer, shown 1 of 3")
    expect(m.get("u4")).toBe("maybe later")
    expect(m.has("u3")).toBe(false)
  })

  it("welcomeLabelsFor before migration 653: read from the first-shown stamp alone", async () => {
    state.missingColumns = NEW_COLUMNS
    state.tables.profiles = [profile({ id: "u2", welcome_offer_seen_at: "2026-09-16T08:00:00.000Z", free_grant_state: "unclaimed" })]
    const m = await welcomeLabelsFor(["u2"])
    expect(m.get("u2")).toBe("no answer, shown 1 of 3")
  })

  it("countSubscribed returns the count, and '?' on error", async () => {
    state.counts.user_consents = { count: 15, error: null }
    expect(await countSubscribed()).toBe("15")
    state.counts.user_consents = { count: null, error: { message: "boom" } }
    expect(await countSubscribed()).toBe("?")
  })
})
