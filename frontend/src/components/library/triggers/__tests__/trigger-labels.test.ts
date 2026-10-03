/**
 * Every run lane is named in the run lists and the editor's notices — the
 * Telegram lanes used to show their raw ids ("telegram_account").
 */
import { describe, it, expect } from "vitest"
import { en } from "@/lib/i18n/en"
import type { MessageKey } from "@/lib/i18n"
import { TRIGGER_LABEL_KEYS, triggerSourceLabel } from "../trigger-labels"

const t = (key: MessageKey, vars?: Record<string, string | number>): string =>
  Object.entries(vars ?? {}).reduce<string>((s, [k, v]) => s.replace(`{${k}}`, String(v)), en[key])

describe("trigger labels", () => {
  it("names both Telegram lanes, and the API lane", () => {
    expect(triggerSourceLabel(t, "telegram_account")).toBe("Telegram account")
    expect(triggerSourceLabel(t, "telegram")).toBe("Telegram bot")
    expect(triggerSourceLabel(t, "api")).toBe("API")
  })

  it("names an MCP run by its client when known", () => {
    expect(triggerSourceLabel(t, "mcp", "Claude")).toBe("via Claude")
    expect(triggerSourceLabel(t, "mcp")).toBe("via MCP")
  })

  it("shows an unknown lane's raw id rather than nothing", () => {
    expect(triggerSourceLabel(t, "some_new_lane")).toBe("some_new_lane")
  })

  it("every label key exists in the dictionary", () => {
    for (const key of Object.values(TRIGGER_LABEL_KEYS)) expect(en[key], key).toBeTruthy()
  })
})
