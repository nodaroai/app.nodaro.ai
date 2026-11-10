import { describe, expect, it, vi } from "vitest"
import { checkMovedPagesSettings } from "../moved-pages-check.js"

/**
 * The image's start script runs the server's own check of the settings that
 * move the app's pages to their own host before it starts anything, so the
 * proxy and /config.js never serve a move the server refuses (a self-host
 * would otherwise run Caddy with it while the API stays down).
 */
describe("checkMovedPagesSettings", () => {
  it("passes on no settings, or a whole move", () => {
    const log = vi.fn()
    expect(checkMovedPagesSettings({}, log)).toBe(0)
    expect(checkMovedPagesSettings({ FLOW_UI_ORIGIN: "https://flow.example.com", LEGACY_UI_HOSTS: "app.example.com", PUBLIC_URL: "https://app.example.com" }, log)).toBe(0)
    expect(log).not.toHaveBeenCalled()
  })

  it("refuses the two Flow names disagreeing, or FLOW_PUBLIC_URL set to spaces, before the proxy or /config.js can turn the move on", () => {
    const move = { LEGACY_UI_HOSTS: "app.example.com", PUBLIC_URL: "https://app.example.com" }
    const log = vi.fn()
    expect(checkMovedPagesSettings({ ...move, FLOW_UI_ORIGIN: "https://flow.example.com", FLOW_PUBLIC_URL: "https://pages.example.com" }, log)).toBe(1)
    expect(log.mock.calls[0][0]).toMatch(/FLOW_PUBLIC_URL and FLOW_UI_ORIGIN/)
    expect(checkMovedPagesSettings({ ...move, FLOW_PUBLIC_URL: "   " }, log)).toBe(1)
    expect(log.mock.calls[1][0]).toMatch(/FLOW_PUBLIC_URL must be/)
  })

  it("refuses what the server refuses, naming the setting", () => {
    const log = vi.fn()
    expect(checkMovedPagesSettings({ FLOW_UI_ORIGIN: "https://flow.example.com", PUBLIC_URL: "https://app.example.com" }, log)).toBe(1)
    expect(log.mock.calls[0][0]).toMatch(/LEGACY_UI_HOSTS/)
  })
})
