/**
 * The graph -> `workflow_triggers` projection. These are the invariants that
 * keep a Schedule Trigger node from being decorative again: the row always
 * carries `rules` (a node written before the rules model — an `interval` such
 * as "5m", a preset cron stored under `interval`, a custom `cron` — converts
 * on the way through, so no legacy key ever reaches the row to shadow them),
 * a re-save is a no-op, a removed node takes its row, and rows a human
 * created by hand are never touched.
 */
import { describe, it, expect } from "vitest"

import {
  applyTriggerConfigPatch,
  desiredTriggersFromGraph,
  isCronExpression,
  mergeTriggerConfig,
  normalizeScheduleConfig,
  normalizeTelegramAccountConfig,
  normalizeTelegramConfig,
  planTriggerSync,
  type ExistingTrigger,
} from "../workflow-trigger-sync.js"

const scheduleNode = (id: string, data: Record<string, unknown>) => ({
  id,
  type: "schedule-trigger",
  data: { label: "Schedule Trigger", ...data },
})

const WEEKDAYS_6AM = { id: "rule-1", kind: "weeks", every: 1, hour: 6, minute: 0, weekdays: [0, 1, 2, 3, 4] }

describe("normalizeScheduleConfig — the node's schedule as the rules the cron evaluates", () => {
  it("a node on the rules model projects its rules, normalised (ids filled, defaults filled)", () => {
    expect(normalizeScheduleConfig({ rules: [{ id: "r1", kind: "minutes", every: 5 }, { kind: "days", hour: 9 }] })).toEqual({
      rules: [
        { id: "r1", kind: "minutes", every: 5 },
        { id: "rule-2", kind: "days", every: 1, hour: 9, minute: 0 },
      ],
    })
  })

  it("a node written before the rules model converts on the way through — no legacy key reaches the row", () => {
    // The old trap: the panel stored its presets ("0 * * * *") under `interval`,
    // which the cron read first and parsed as 0 ms — a schedule that never fired.
    expect(normalizeScheduleConfig({ interval: "0 * * * *" })).toEqual({ rules: [{ id: "rule-1", kind: "hours", every: 1, minute: 0 }] })
    expect(normalizeScheduleConfig({ interval: "*/15 * * * *" })).toEqual({ rules: [{ id: "rule-1", kind: "minutes", every: 15 }] })
    expect(normalizeScheduleConfig({ interval: "30m" })).toEqual({ rules: [{ id: "rule-1", kind: "minutes", every: 30 }] })
    expect(normalizeScheduleConfig({ interval: "1d" })).toEqual({ rules: [{ id: "rule-1", kind: "days", every: 1, hour: 0, minute: 0 }] })
    expect(normalizeScheduleConfig({ interval: "custom", cron: "0 6 * * 0-4" })).toEqual({ rules: [WEEKDAYS_6AM] })
    // `cronExpression` is the name the old panel used while the node type, the
    // node card and the table all said `cron`.
    expect(normalizeScheduleConfig({ interval: "custom", cronExpression: "0 6 * * 0-4" })).toEqual({ rules: [WEEKDAYS_6AM] })
    // A cron no plain sentence can say stays a cron rule.
    expect(normalizeScheduleConfig({ interval: "custom", cron: "0 6 * 3 *" })).toEqual({ rules: [{ id: "rule-1", kind: "cron", cron: "0 6 * 3 *" }] })
    for (const config of [normalizeScheduleConfig({ interval: "30m" }), normalizeScheduleConfig({ interval: "custom", cron: "5 5 * * *" })]) {
      expect(config).not.toHaveProperty("interval")
      expect(config).not.toHaveProperty("cron")
    }
  })

  it("rules present means rules — a stale legacy key beside them is ignored", () => {
    expect(normalizeScheduleConfig({ rules: [{ kind: "hours", every: 2 }], interval: "5m", cron: "* * * * *" }))
      .toEqual({ rules: [{ id: "rule-1", kind: "hours", every: 2, minute: 0 }] })
  })

  it("carries a timezone and a positive maxExecutions, and drops the rest", () => {
    expect(normalizeScheduleConfig({
      interval: "custom",
      cron: "0 6 * * 0-4",
      timezone: "Asia/Jerusalem",
      maxExecutions: 3,
    })).toEqual({ rules: [WEEKDAYS_6AM], timezone: "Asia/Jerusalem", maxExecutions: 3 })

    expect(normalizeScheduleConfig({ rules: [{ kind: "minutes", every: 5 }], timezone: "  ", maxExecutions: 0 }))
      .toEqual({ rules: [{ id: "rule-1", kind: "minutes", every: 5 }] })
  })

  it("refuses a timezone the runtime cannot read — never a silent UTC fallback", () => {
    expect(normalizeScheduleConfig({ rules: [{ kind: "days", hour: 9 }], timezone: "Jerusalem" })).toBeNull()
    expect(normalizeScheduleConfig({ interval: "1h", timezone: "Not/AZone" })).toBeNull()
  })

  it("returns null for a node that is not configured enough to run", () => {
    // A half-filled node must not quietly start firing.
    expect(normalizeScheduleConfig({})).toBeNull()
    expect(normalizeScheduleConfig({ rules: [] })).toBeNull()
    expect(normalizeScheduleConfig({ rules: [{ kind: "weeks", weekdays: [] }] })).toBeNull()
    expect(normalizeScheduleConfig({ rules: [{ kind: "seconds", every: 30 }] })).toBeNull()
    expect(normalizeScheduleConfig({ rules: [{ kind: "cron", cron: "0 6 * *" }] })).toBeNull()
    expect(normalizeScheduleConfig({ interval: "custom" })).toBeNull()
    expect(normalizeScheduleConfig({ interval: "custom", cron: "" })).toBeNull()
    expect(normalizeScheduleConfig({ interval: "every day" })).toBeNull()
    expect(normalizeScheduleConfig({ cron: "0 6 * *" })).toBeNull()
  })
})

describe("isCronExpression", () => {
  it("accepts exactly five fields", () => {
    expect(isCronExpression("0 6 * * 0-4")).toBe(true)
    expect(isCronExpression("  0   6 * * *  ")).toBe(true)
    expect(isCronExpression("0 6 * *")).toBe(false)
    expect(isCronExpression("0 6 * * * *")).toBe(false)
    expect(isCronExpression("30m")).toBe(false)
  })
})

describe("desiredTriggersFromGraph", () => {
  it("picks up configured schedule nodes and every webhook node", () => {
    expect(desiredTriggersFromGraph([
      scheduleNode("s1", { interval: "0 6 * * 0-4", timezone: "Asia/Jerusalem" }),
      { id: "w1", type: "webhook-trigger", data: { label: "Webhook", params: [] } },
      { id: "g1", type: "generate-image", data: { prompt: "a cat" } },
      scheduleNode("s2", { interval: "custom" }),
    ])).toEqual([
      { nodeId: "s1", type: "schedule", config: { rules: [WEEKDAYS_6AM], timezone: "Asia/Jerusalem" }, isActive: false },
      { nodeId: "w1", type: "webhook", config: {}, isActive: true },
      // Half-configured: on the graph, cannot run — PARKED (see planTriggerSync).
      { nodeId: "s2", type: "schedule", config: {}, isActive: false, parked: true },
    ])
  })

  it("a schedule fires only when its node's switch is on — a new schedule starts paused; a webhook is always armed", () => {
    const [off, on, onByString] = desiredTriggersFromGraph([
      scheduleNode("s1", { rules: [{ kind: "days", hour: 9 }] }),
      scheduleNode("s2", { rules: [{ kind: "days", hour: 9 }], active: true }),
      scheduleNode("s3", { rules: [{ kind: "days", hour: 9 }], active: "true" }),
    ])
    expect(off.isActive).toBe(false)
    expect(on.isActive).toBe(true)
    // Only the boolean arms a schedule — an API write of a truthy string does not.
    expect(onByString.isActive).toBe(false)
  })

  it("survives an empty, missing or malformed graph", () => {
    expect(desiredTriggersFromGraph(undefined)).toEqual([])
    expect(desiredTriggersFromGraph([])).toEqual([])
    expect(desiredTriggersFromGraph([{ type: "schedule-trigger" }])).toEqual([])
    expect(desiredTriggersFromGraph([{ id: "s1", type: "schedule-trigger", data: null }])).toEqual([
      { nodeId: "s1", type: "schedule", config: {}, isActive: false, parked: true },
    ])
  })

  it("rules present means rules — an EMPTY rules list beside a legacy interval is no schedule, not the interval", () => {
    expect(normalizeScheduleConfig({ rules: [], interval: "5m" })).toBeNull()
  })
})

describe("applyTriggerConfigPatch — what PATCH /v1/workflow-triggers/:id does to a stored config", () => {
  const row = { rules: [{ id: "rule-1", kind: "minutes", every: 5 }], timezone: "UTC", nodeId: "s1", executionCount: 7 }

  it("keeps what was not sent — and always the row's nodeId and executionCount", () => {
    expect(applyTriggerConfigPatch(row, { timezone: "Asia/Jerusalem" })).toEqual({ ...row, timezone: "Asia/Jerusalem" })
    expect(applyTriggerConfigPatch(row, { nodeId: "other", executionCount: 0, maxExecutions: 3 })).toEqual({ ...row, maxExecutions: 3 })
  })

  it("one family of schedule keys at a time: rules drop a stored interval/cron, and the other way round", () => {
    expect(applyTriggerConfigPatch({ interval: "5m", nodeId: "s1" }, { rules: [{ id: "r", kind: "hours", every: 1, minute: 0 }] }))
      .toEqual({ rules: [{ id: "r", kind: "hours", every: 1, minute: 0 }], nodeId: "s1" })
    expect(applyTriggerConfigPatch(row, { cron: "0 9 * * *" })).toEqual({ cron: "0 9 * * *", timezone: "UTC", nodeId: "s1", executionCount: 7 })
  })

  it("a row with no config takes the patch as it is — and a hand-made row never grows a nodeId from a caller", () => {
    expect(applyTriggerConfigPatch(null, { interval: "1h" })).toEqual({ interval: "1h" })
    expect(applyTriggerConfigPatch({ cron: "0 3 * * *" }, { nodeId: "planted", executionCount: 99, timezone: "UTC" })).toEqual({ cron: "0 3 * * *", timezone: "UTC" })
  })
})

describe("mergeTriggerConfig", () => {
  it("a row written before the rules model loses its legacy keys when the rules arrive — nothing left to shadow them", () => {
    const merged = mergeTriggerConfig(
      { interval: "30m", timezone: "UTC", nodeId: "s1", executionCount: 4 },
      { rules: [{ id: "rule-1", kind: "minutes", every: 30 }] },
      "s1",
    )
    expect(merged).toEqual({ rules: [{ id: "rule-1", kind: "minutes", every: 30 }], nodeId: "s1", executionCount: 4 })
    expect(merged).not.toHaveProperty("interval")
    expect(merged).not.toHaveProperty("timezone")
  })

  it("preserves runtime state the cron writes back", () => {
    const merged = mergeTriggerConfig(
      { cron: "0 5 * * *", nodeId: "s1", executionCount: 12 },
      { cron: "0 6 * * 0-4" },
      "s1",
    )
    expect(merged).toEqual({ cron: "0 6 * * 0-4", nodeId: "s1", executionCount: 12 })
  })

  it("drops a stale schedule key so it cannot shadow the new one", () => {
    // interval wins over cron in shouldTriggerFire, so a leftover `interval`
    // would silently keep an old schedule alive.
    const merged = mergeTriggerConfig(
      { interval: "30m", timezone: "UTC", nodeId: "s1", executionCount: 4 },
      { cron: "0 6 * * 0-4" },
      "s1",
    )
    expect(merged).toEqual({ cron: "0 6 * * 0-4", nodeId: "s1", executionCount: 4 })
    expect(merged).not.toHaveProperty("interval")
    expect(merged).not.toHaveProperty("timezone")
  })
})

describe("planTriggerSync", () => {
  const owned = (id: string, nodeId: string, config: Record<string, unknown>, isActive = true): ExistingTrigger =>
    ({ id, type: "schedule", config: { ...config, nodeId }, is_active: isActive })
  const wanted = (nodeId: string, config: Record<string, unknown>, isActive = true) =>
    ({ nodeId, type: "schedule" as const, config, isActive })

  it("creates a row for a new schedule node", () => {
    const plan = planTriggerSync(
      [wanted("s1", { cron: "0 6 * * 0-4" })],
      [],
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it("is a no-op when nothing changed (every later save) — a paused node with a paused row included", () => {
    expect(planTriggerSync(
      [wanted("s1", { cron: "0 6 * * 0-4" })],
      [owned("t1", "s1", { cron: "0 6 * * 0-4" })],
    )).toEqual({ create: [], update: [], remove: [] })
    expect(planTriggerSync(
      [wanted("s1", { cron: "0 6 * * 0-4" }, false)],
      [owned("t1", "s1", { cron: "0 6 * * 0-4" }, false)],
    )).toEqual({ create: [], update: [], remove: [] })
  })

  it("the node's switch reaches the row — on resumes a paused row, off pauses an armed one — without losing its execution count", () => {
    const resumed = planTriggerSync(
      [wanted("s1", { cron: "0 6 * * 0-4" }, true)],
      [owned("t1", "s1", { cron: "0 6 * * 0-4", executionCount: 9 }, false)],
    )
    expect(resumed.update).toEqual([
      { id: "t1", config: { cron: "0 6 * * 0-4", nodeId: "s1", executionCount: 9 }, isActive: true },
    ])
    const paused = planTriggerSync(
      [wanted("s1", { cron: "0 6 * * 0-4" }, false)],
      [owned("t1", "s1", { cron: "0 6 * * 0-4", executionCount: 9 }, true)],
    )
    expect(paused.update).toEqual([
      { id: "t1", config: { cron: "0 6 * * 0-4", nodeId: "s1", executionCount: 9 }, isActive: false },
    ])
  })

  it("removes the row when its node leaves the graph", () => {
    const plan = planTriggerSync([], [owned("t1", "s1", { cron: "0 6 * * 0-4" })])
    expect(plan.remove).toEqual(["t1"])
    expect(plan.create).toEqual([])
  })

  it("a parked node stays paused whatever its switch says", () => {
    const armedButUnrunnable = [{ nodeId: "s1", type: "schedule" as const, config: {}, isActive: true, parked: true as const }]
    const plan = planTriggerSync(armedButUnrunnable, [owned("t1", "s1", { rules: [{ id: "rule-1", kind: "minutes", every: 5 }], executionCount: 2 }, true)])
    expect(plan.update).toEqual([{ id: "t1", config: { nodeId: "s1", executionCount: 2 }, isActive: false }])
    expect(planTriggerSync(armedButUnrunnable, []).create).toEqual([])
  })

  it("a node that cannot run is PARKED: its row is kept paused with the schedule cleared and the count intact; none is created", () => {
    const parked = [{ nodeId: "s1", type: "schedule" as const, config: {}, isActive: false, parked: true as const }]
    expect(planTriggerSync(parked, [])).toEqual({ create: [], update: [], remove: [] })
    const plan = planTriggerSync(parked, [owned("t1", "s1", { rules: [{ id: "rule-1", kind: "minutes", every: 5 }], timezone: "UTC", executionCount: 4 }, true)])
    expect(plan.update).toEqual([{ id: "t1", config: { nodeId: "s1", executionCount: 4 }, isActive: false }])
    expect(plan.remove).toEqual([])
    // ...and once it is fixed, the same row wakes up with its count.
    const fixed = planTriggerSync(
      [wanted("s1", { rules: [{ id: "rule-1", kind: "minutes", every: 5 }] })],
      [owned("t1", "s1", { executionCount: 4 }, false)],
    )
    expect(fixed.update).toEqual([{ id: "t1", config: { rules: [{ id: "rule-1", kind: "minutes", every: 5 }], nodeId: "s1", executionCount: 4 }, isActive: true }])
  })

  it("never touches a row created by hand (no nodeId)", () => {
    const byHand: ExistingTrigger = {
      id: "curl-1",
      type: "schedule",
      config: { cron: "0 3 * * *" },
      is_active: true,
    }
    expect(planTriggerSync([], [byHand])).toEqual({ create: [], update: [], remove: [] })

    // ...and it does not satisfy a graph node either: the node still gets its own row.
    const plan = planTriggerSync(
      [wanted("s1", { cron: "0 6 * * 0-4" })],
      [byHand],
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.remove).toEqual([])
  })

  it("keys on type as well as node id", () => {
    const plan = planTriggerSync(
      [{ nodeId: "n1", type: "webhook", config: {}, isActive: true }],
      [owned("t1", "n1", { cron: "0 6 * * 0-4" })],
    )
    expect(plan.create).toEqual([{ nodeId: "n1", type: "webhook", config: {}, isActive: true }])
    expect(plan.remove).toEqual(["t1"])
  })

  it("sweeps duplicate owned rows for the same node", () => {
    const plan = planTriggerSync(
      [wanted("s1", { cron: "0 6 * * 0-4" })],
      [owned("t1", "s1", { cron: "0 6 * * 0-4" }), owned("t2", "s1", { cron: "0 6 * * 0-4" })],
    )
    expect(plan.remove).toEqual(["t2"])
    expect(plan.create).toEqual([])
  })
})

/**
 * Telegram Trigger — the third projected type, and the only one whose row
 * means a live registration at a bot. These pin the two conditions that keep
 * it from listening to a user's chats before they asked, and the one shape
 * change a row cannot absorb in place.
 */
const telegramNode = (id: string, data: Record<string, unknown>) => ({
  id,
  type: "telegram-trigger",
  data: { label: "Telegram Trigger", ...data },
})

const ALL_TYPES = ["text", "photo", "video", "audio", "document"]

describe("normalizeTelegramConfig", () => {
  it("projects nothing without a bot — there is nothing to point at Telegram", () => {
    expect(normalizeTelegramConfig({ isActive: true })).toBeNull()
    expect(normalizeTelegramConfig({ isActive: true, connectionId: "   " })).toBeNull()
  })

  it("projects nothing until the user activates it — a picked bot is not consent to read their chats", () => {
    expect(normalizeTelegramConfig({ connectionId: "conn-1" })).toBeNull()
    expect(normalizeTelegramConfig({ connectionId: "conn-1", isActive: false })).toBeNull()
    // Not a truthy check: only a real `true` arms it.
    expect(normalizeTelegramConfig({ connectionId: "conn-1", isActive: "yes" })).toBeNull()
  })

  it("emits the bot, the filters, and every message type when none is chosen", () => {
    expect(normalizeTelegramConfig({ connectionId: "conn-1", isActive: true })).toEqual({
      connectionId: "conn-1",
      chatIdFilter: null,
      messageTypeFilters: ALL_TYPES,
    })
  })

  it("emits a CLEARED chat filter as null rather than omitting it", () => {
    // mergeTriggerConfig keeps whatever the desired config does not mention,
    // so an omitted key would leave the old filter standing on the row.
    const config = normalizeTelegramConfig({ connectionId: "conn-1", isActive: true, chatIdFilter: "  " })
    expect(config).toHaveProperty("chatIdFilter", null)
  })

  it("keeps the chosen message types, dropping junk entries", () => {
    expect(normalizeTelegramConfig({
      connectionId: "conn-1",
      isActive: true,
      chatIdFilter: "@news",
      messageTypeFilters: ["photo", "", 7, "video"],
    })).toEqual({ connectionId: "conn-1", chatIdFilter: "@news", messageTypeFilters: ["photo", "video"] })
  })
})

describe("desiredTriggersFromGraph — telegram", () => {
  it("projects an armed node and skips a half-configured one", () => {
    expect(desiredTriggersFromGraph([
      telegramNode("tg1", { connectionId: "conn-1", isActive: true }),
      telegramNode("tg2", { connectionId: "conn-1" }),
      telegramNode("tg3", { isActive: true }),
    ])).toEqual([
      { nodeId: "tg1", type: "telegram", config: { connectionId: "conn-1", chatIdFilter: null, messageTypeFilters: ALL_TYPES }, isActive: true },
    ])
  })
})

describe("the Telegram ACCOUNT lane", () => {
  const accountNode = (id: string, data: Record<string, unknown>) => ({
    id,
    type: "telegram-account-trigger",
    data: { label: "Telegram account", ...data },
  })

  it("listens only once switched on with an account picked", () => {
    expect(normalizeTelegramAccountConfig({ accountId: "acc-1" })).toBeNull()
    expect(normalizeTelegramAccountConfig({ isActive: true })).toBeNull()
    expect(normalizeTelegramAccountConfig({ accountId: "  ", isActive: true, chatIds: ["-1001"] })).toBeNull()
    // No chat picked is not "every chat".
    expect(normalizeTelegramAccountConfig({ accountId: "acc-1", isActive: true })).toBeNull()
    expect(normalizeTelegramAccountConfig({ accountId: "acc-1", isActive: true, chatIds: ["  "] })).toBeNull()
  })

  it("emits every filter, trimmed and de-duplicated, so a cleared filter never survives on the row", () => {
    expect(
      normalizeTelegramAccountConfig({
        accountId: " acc-1 ",
        isActive: true,
        chatIds: ["-1001", " -1001 ", "@news", "", 7],
        keywords: ["launch"],
        includeOutgoing: "yes",
      }),
    ).toEqual({
      accountId: "acc-1",
      chatIds: ["-1001", "@news"],
      senderIds: [],
      messageTypeFilters: [],
      keywords: ["launch"],
      includeOutgoing: false,
    })
  })

  it("projects an armed node as a telegram_account row and skips an unarmed one", () => {
    expect(
      desiredTriggersFromGraph([
        accountNode("ta1", { accountId: "acc-1", isActive: true, chatIds: ["-1001"] }),
        accountNode("ta2", { accountId: "acc-1" }),
      ]),
    ).toEqual([
      {
        nodeId: "ta1",
        type: "telegram_account",
        config: { accountId: "acc-1", chatIds: ["-1001"], senderIds: [], messageTypeFilters: [], keywords: [], includeOutgoing: false },
        isActive: true,
      },
    ])
  })
})

describe("planTriggerSync — telegram", () => {
  const tgRow = (id: string, nodeId: string, config: Record<string, unknown>): ExistingTrigger => ({
    id,
    type: "telegram",
    config: { ...config, nodeId },
    is_active: true,
  })

  it("deactivating a node reconciles its row away — off IS removal here", () => {
    const plan = planTriggerSync([], [tgRow("t1", "tg1", { connectionId: "conn-1" })])
    expect(plan.remove).toEqual(["t1"])
    expect(plan.create).toEqual([])
  })

  it("an edited filter is an in-place update, not a re-registration", () => {
    const plan = planTriggerSync(
      [{ nodeId: "tg1", type: "telegram", config: { connectionId: "conn-1", chatIdFilter: "@news", messageTypeFilters: ALL_TYPES }, isActive: true }],
      [tgRow("t1", "tg1", { connectionId: "conn-1", chatIdFilter: null, messageTypeFilters: ALL_TYPES })],
    )
    expect(plan.create).toEqual([])
    expect(plan.remove).toEqual([])
    expect(plan.update).toHaveLength(1)
    // The secret the registration minted is runtime state and must survive.
    expect(plan.update[0].config).toMatchObject({ chatIdFilter: "@news", nodeId: "tg1" })
  })

  it("keeps the secret the registration minted across an edit", () => {
    const plan = planTriggerSync(
      [{ nodeId: "tg1", type: "telegram", config: { connectionId: "conn-1", chatIdFilter: "@news", messageTypeFilters: ALL_TYPES }, isActive: true }],
      [tgRow("t1", "tg1", { connectionId: "conn-1", chatIdFilter: null, messageTypeFilters: ALL_TYPES, secretToken: "shh" })],
    )
    expect(plan.update[0].config).toMatchObject({ secretToken: "shh" })
  })

  it("switching the BOT replaces the row — the old bot has a registration to take down", () => {
    const plan = planTriggerSync(
      [{ nodeId: "tg1", type: "telegram", config: { connectionId: "conn-2", chatIdFilter: null, messageTypeFilters: ALL_TYPES }, isActive: true }],
      [tgRow("t1", "tg1", { connectionId: "conn-1", chatIdFilter: null, messageTypeFilters: ALL_TYPES })],
    )
    expect(plan.remove).toEqual(["t1"])
    expect(plan.create).toHaveLength(1)
    expect(plan.update).toEqual([])
  })

  it("leaves a telegram row created through the API (no nodeId) alone", () => {
    const byApi: ExistingTrigger = {
      id: "api-1",
      type: "telegram",
      config: { connectionId: "conn-1", secretToken: "shh" },
      is_active: true,
    }
    expect(planTriggerSync([], [byApi])).toEqual({ create: [], update: [], remove: [] })
  })
})

describe("planTriggerSync — an inactive telegram row", () => {
  it("is replaced rather than flipped back on: deactivation gave its url up, and only a create registers one", () => {
    // The API's deactivate clears the token and may have taken the bot's
    // webhook down. An UPDATE to is_active=true would leave a trigger that is
    // active on paper and reachable by nothing.
    const parked: ExistingTrigger = {
      id: "t1",
      type: "telegram",
      config: { nodeId: "tg1", connectionId: "conn-1", chatIdFilter: null, messageTypeFilters: ["text"], secretToken: "shh" },
      is_active: false,
      webhook_token: null,
    }
    const plan = planTriggerSync(
      [{ nodeId: "tg1", type: "telegram", config: { connectionId: "conn-1", chatIdFilter: null, messageTypeFilters: ["text"] }, isActive: true }],
      [parked],
    )
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual(["t1"])
    expect(plan.create).toHaveLength(1)
  })

  it("an inactive SCHEDULE row is still just reactivated in place — the rule is telegram's alone", () => {
    const parked: ExistingTrigger = { id: "s1", type: "schedule", config: { nodeId: "n1", cron: "0 6 * * *" }, is_active: false }
    const plan = planTriggerSync([{ nodeId: "n1", type: "schedule", config: { cron: "0 6 * * *" }, isActive: true }], [parked])
    expect(plan.remove).toEqual([])
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual([{ id: "s1", config: { cron: "0 6 * * *", nodeId: "n1" }, isActive: true }])
  })
})
