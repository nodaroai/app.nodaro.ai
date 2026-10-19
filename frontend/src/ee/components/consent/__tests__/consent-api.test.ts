import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/api", () => ({ getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: "Bearer t" }) }))

import { grantConsent, declineConsent, withdrawConsent } from "../consent-api"
import { useLocaleStore } from "@/lib/locale-store"
import { isOfferedLocale } from "@/lib/i18n/offered-locales"
import { LANGUAGES, type LocaleId } from "@nodaro/shared/i18n"

const fetchMock = vi.fn()
const bodyOf = (call = 0): Record<string, unknown> => JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string)
const urlOf = (call = 0): string => fetchMock.mock.calls[call][0] as string

const NOT_TRANSLATED: LocaleId | undefined = LANGUAGES.map((l) => l.id).find((id) => !isOfferedLocale(id))

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200 })
  vi.stubGlobal("fetch", fetchMock)
  useLocaleStore.setState({ locale: "ja" })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useLocaleStore.setState({ locale: "en" })
})

describe("the consent calls carry the interface language the answer was given in", () => {
  it("grant: the answering app and the language", async () => {
    await grantConsent("app")
    expect(urlOf()).toBe("/v1/consent/grant")
    expect(bodyOf()).toEqual({ sourceApp: "app", locale: "ja" })
  })

  it("grant without an app still carries the language", async () => {
    await grantConsent()
    expect(bodyOf()).toEqual({ locale: "ja" })
  })

  it("decline carries the language", async () => {
    await declineConsent()
    expect(urlOf()).toBe("/v1/consent/decline")
    expect(bodyOf()).toEqual({ locale: "ja" })
  })

  it("withdraw carries the language", async () => {
    await withdrawConsent()
    expect(urlOf()).toBe("/v1/consent/withdraw")
    expect(bodyOf()).toEqual({ locale: "ja" })
  })

  it.skipIf(!NOT_TRANSLATED)("says English when the chosen language's chrome is not translated yet", async () => {
    useLocaleStore.setState({ locale: NOT_TRANSLATED })
    await grantConsent("app")
    expect(bodyOf()).toEqual({ sourceApp: "app", locale: "en" })
  })

  it("still throws when the server refuses, so the card stays up for a retry", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    await expect(grantConsent("app")).rejects.toThrow("/v1/consent/grant failed (500)")
  })
})
