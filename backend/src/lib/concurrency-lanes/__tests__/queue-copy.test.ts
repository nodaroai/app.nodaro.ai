import { describe, expect, it } from "vitest"
import { englishOrdinal, mcpQueueLine, upgradeHintLine } from "../queue-copy.js"
import type { QueueInfo } from "../queue-info.js"

const queue = (over: Partial<QueueInfo> = {}): QueueInfo => ({
  lane: "provider",
  position: 3,
  limit: 4,
  running: 4,
  reason: "user_lane",
  waitedSeconds: 12,
  upgradeHint: null,
  ...over,
})

describe("englishOrdinal", () => {
  it.each([
    [1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [10, "10th"],
    [11, "11th"], [12, "12th"], [13, "13th"], [14, "14th"],
    [21, "21st"], [22, "22nd"], [23, "23rd"], [101, "101st"],
    [111, "111th"], [112, "112th"], [113, "113th"], [1002, "1002nd"],
  ])("%i → %s", (n, expected) => {
    expect(englishOrdinal(n)).toBe(expected)
  })
})

describe("mcpQueueLine", () => {
  it("the payer's own line full: the MCP queued-timeout copy", () => {
    expect(mcpQueueLine(queue())).toBe("Still waiting — 3rd in line (your plan runs 4 at once). Call wait_for_job again to keep waiting.")
  })

  it("a provider ceiling: busy across the platform", () => {
    expect(mcpQueueLine(queue({ reason: "provider_ceiling", position: 11 }))).toBe(
      "Waiting — busy across the platform, 11th in line. Call wait_for_job again to keep waiting.",
    )
  })

  it("the server's share reads like a provider ceiling", () => {
    expect(mcpQueueLine(queue({ reason: "server_busy", position: 1, limit: 0 }))).toBe(
      "Waiting — busy across the platform, 1st in line. Call wait_for_job again to keep waiting.",
    )
  })

  it("a run waits to start", () => {
    expect(mcpQueueLine(queue({ lane: "run", position: 2, limit: 1 }))).toBe(
      "Waiting to start — 2nd in line, your plan allows 1 run at once. Call wait_for_job again to keep waiting.",
    )
  })

  it("more than one run is plural", () => {
    expect(mcpQueueLine(queue({ lane: "run", position: 3, limit: 4 }))).toBe(
      "Waiting to start — 3rd in line, your plan allows 4 runs at once. Call wait_for_job again to keep waiting.",
    )
  })

  it("a run held by the server's share is busy across the platform, never 'allows 0 runs'", () => {
    expect(mcpQueueLine(queue({ lane: "run", reason: "server_busy", position: 2, limit: 0 }))).toBe(
      "Waiting — busy across the platform, 2nd in line. Call wait_for_job again to keep waiting.",
    )
  })
})

describe("upgradeHintLine", () => {
  it("a personal or deployment payer upgrades its plan; a workspace member asks the owner; none without a hint", () => {
    expect(upgradeHintLine("plan")).toBe("Need more at once? Upgrade your plan.")
    expect(upgradeHintLine("workspace")).toBe("Need more at once? Ask your workspace owner to upgrade.")
    expect(upgradeHintLine(null)).toBeNull()
  })
})
