import { describe, expect, it } from "vitest"
import { MAX_APPS_PER_USER, countCappedApps, isCapReached } from "../dev-app-cap"

// Mirrors the server rule: only hand-registered apps count toward the cap.
describe("countCappedApps", () => {
  it("ignores self-registered MCP clients", () => {
    const apps = [
      { kind: "dynamic_mcp" },
      { kind: "dynamic_mcp" },
      { kind: "first_party_mcp" },
      { kind: "community_instance" },
      { kind: "user" },
    ]
    expect(countCappedApps(apps)).toBe(1)
  })

  it("reads a missing kind as a hand-registered app (older server)", () => {
    expect(countCappedApps([{}, { kind: undefined }])).toBe(2)
  })

  it("five Claude connections leave the cap untouched", () => {
    const claude = Array.from({ length: 5 }, () => ({ kind: "dynamic_mcp" }))
    expect(countCappedApps(claude)).toBeLessThan(MAX_APPS_PER_USER)
  })
})

describe("isCapReached", () => {
  const five = Array.from({ length: MAX_APPS_PER_USER }, () => ({ kind: "user" }))

  it("caps a regular user at five hand-registered apps", () => {
    expect(isCapReached(five, { isAdmin: false })).toBe(true)
    expect(isCapReached(five.slice(1), { isAdmin: false })).toBe(false)
  })

  it("never caps an admin", () => {
    expect(isCapReached([...five, ...five], { isAdmin: true })).toBe(false)
  })
})
