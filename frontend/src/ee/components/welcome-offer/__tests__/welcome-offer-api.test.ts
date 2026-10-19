import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/api", () => ({ getAuthHeaders: vi.fn().mockResolvedValue({ Authorization: "Bearer t" }) }))

import { claimWelcomeOffer } from "../welcome-offer-api"
import { useLocaleStore } from "@/lib/locale-store"
import { isOfferedLocale } from "@/lib/i18n/offered-locales"
import { LANGUAGES, type LocaleId } from "@nodaro/shared/i18n"

const fetchMock = vi.fn()
const bodyOf = (): Record<string, unknown> => JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)

const CLAIMED = { consent: "granted", grant: "granted", credits: 1500 }
const NOT_TRANSLATED: LocaleId | undefined = LANGUAGES.map((l) => l.id).find((id) => !isOfferedLocale(id))

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => CLAIMED })
  vi.stubGlobal("fetch", fetchMock)
  useLocaleStore.setState({ locale: "ja" })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useLocaleStore.setState({ locale: "en" })
})

describe("claimWelcomeOffer", () => {
  it("posts the answering app, the interface language and the browser signals", async () => {
    const result = await claimWelcomeOffer({ browserKey: "bk", deviceKey: "dk" })

    expect(fetchMock.mock.calls[0][0]).toBe("/v1/credits/welcome-offer/claim")
    expect(bodyOf()).toEqual({ sourceApp: "app", locale: "ja", browserKey: "bk", deviceKey: "dk" })
    expect(result).toEqual(CLAIMED)
  })

  it("carries the language even when there are no browser signals", async () => {
    await claimWelcomeOffer({})
    expect(bodyOf()).toEqual({ sourceApp: "app", locale: "ja" })
  })

  it.skipIf(!NOT_TRANSLATED)("says English when the chosen language's chrome is not translated yet", async () => {
    useLocaleStore.setState({ locale: NOT_TRANSLATED })
    await claimWelcomeOffer({})
    expect(bodyOf()).toMatchObject({ locale: "en" })
  })

  it("throws when the claim fails, so the popup keeps its button for a retry", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    await expect(claimWelcomeOffer({})).rejects.toThrow("welcome offer claim failed (503)")
  })
})
