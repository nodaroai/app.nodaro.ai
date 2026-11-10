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

  it("refuses what the server refuses, naming the setting", () => {
    const log = vi.fn()
    expect(checkMovedPagesSettings({ FLOW_UI_ORIGIN: "https://flow.example.com", PUBLIC_URL: "https://app.example.com" }, log)).toBe(1)
    expect(log.mock.calls[0][0]).toMatch(/LEGACY_UI_HOSTS/)
  })
})
