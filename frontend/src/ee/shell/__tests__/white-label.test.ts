import { describe, expect, it, vi } from "vitest"
import type { NodaroClient } from "@nodaro/sdk/client"
import type { UserBalance } from "@nodaro/sdk/credits"
import {
  headerBalance,
  imageOriginsFor,
  unitTranslator,
  whiteLabelWorlds,
  withHeaderBalance,
  type UnitWords,
} from "../white-label"

/**
 * The pieces of the white-label header that are pure: which worlds it draws,
 * which origins it may draw images from, the language list, and the figures
 * and words of its credit pill — taken from the server's converted `display`
 * figures, the way the sidebar card picks its headline.
 */

const BASE: UserBalance = {
  subscription: 300,
  topup: 50,
  total: 350,
  tier: "pro",
  effectiveTier: "pro",
  dailySpent: 0,
  dailyLimit: null,
  monthlyAllocation: 1000,
} as unknown as UserBalance

describe("whiteLabelWorlds", () => {
  it("the server's answer when it has one: its order, only worlds with an address on the site", () => {
    expect(whiteLabelWorlds({ allow: ["image", "video", "music", "app"] }, ["video", "explore", "image", "studio", "app"])).toEqual(["video", "image", "app"])
  })

  it("before the answer (or from an older server): the profile's allowlist, in its order", () => {
    expect(whiteLabelWorlds({ allow: ["music", "image", "app", "explore"], order: ["app", "image"] }, null)).toEqual(["app", "image", "music"])
  })

  it("no allowlist: every world with an address on the site, in the canonical order", () => {
    expect(whiteLabelWorlds(undefined, null)).toEqual(["image", "video", "music", "trends", "motion", "voice", "app"])
  })

  it("an empty allowlist draws no world", () => {
    expect(whiteLabelWorlds({ allow: [] }, null)).toEqual([])
  })
})

describe("imageOriginsFor", () => {
  it("the logo's https origin, when the logo is on another host; none for a path on the site", () => {
    expect(imageOriginsFor("https://media.example.com/brand/logo.svg", undefined)).toEqual(["https://media.example.com"])
    expect(imageOriginsFor("/brand/logo.svg", undefined)).toEqual([])
    expect(imageOriginsFor(undefined, undefined)).toEqual([])
  })

  it("the deployment's media host beside the logo's", () => {
    expect(imageOriginsFor("https://logo.example.com/logo.svg", "https://media.example.com")).toEqual(["https://logo.example.com", "https://media.example.com"])
    expect(imageOriginsFor("/brand/logo.svg", "https://media.example.com")).toEqual(["https://media.example.com"])
    expect(imageOriginsFor(undefined, "https://media.example.com")).toEqual(["https://media.example.com"])
  })

  it("one origin once, when the logo lives on the media host", () => {
    expect(imageOriginsFor("https://media.example.com/brand/logo.svg", "https://media.example.com")).toEqual(["https://media.example.com"])
  })
})

describe("headerBalance", () => {
  it("a deployment with no unit, no payer and no outside wallet: the balance as sent", () => {
    expect(headerBalance(BASE, "en")).toBe(BASE)
  })

  it("a single payer: the caller's allowance is the headline, and the meter is what is left of it", () => {
    const balance = { ...BASE, total: 0, allowance: { granted: 2000, remaining: 1500, enforced: true } } as UserBalance
    const view = headerBalance(balance, "en")
    expect(view).toMatchObject({ total: 1500, subscription: 1500, monthlyAllocation: 2000 })
    // The header draws a month meter only beside the account's own wallet: handed an allowance, it would draw none.
    expect(view.allowance).toBeFalsy()
  })

  it("an outside wallet: its available figure, no meter; unknown stays unknown, never 0", () => {
    const balance = { ...BASE, externalWallet: { available: 420 } } as UserBalance
    expect(headerBalance(balance, "en")).toMatchObject({ total: 420, monthlyAllocation: 0 })
    const unknown = headerBalance({ ...BASE, externalWallet: { available: null } } as UserBalance, "en")
    expect(unknown.total).toBeUndefined()
  })

  it("the deployment's own unit: the server's converted figures, never a conversion of its own", () => {
    const balance = {
      ...BASE,
      total: 0,
      allowance: { granted: 2000, remaining: 1500, enforced: false },
      display: { unit: "tokens", decimals: 0, total: 0, subscription: 0, topup: 0, dailySpent: 0, dailyLimit: null, monthlyAllocation: 0, appCreditsAllowance: 0, allowance: { granted: 8000000, remaining: 6000000 } },
    } as unknown as UserBalance
    const view = headerBalance(balance, "en")
    expect(view).toMatchObject({ total: 6000000, subscription: 6000000, monthlyAllocation: 8000000 })
    // In a unit the header reads `display` itself: the allowance is its own wallet there too, so the meter is drawn.
    expect(view.allowance).toBeFalsy()
    expect(view.display).toMatchObject({ unit: "tokens", total: 6000000, subscription: 6000000, monthlyAllocation: 8000000 })
  })

  it("with a unit and an allowance the server could not convert: unknown stays unknown, no meter", () => {
    const balance = {
      ...BASE,
      total: 0,
      allowance: { granted: 2000, remaining: 1500, enforced: false },
      display: { unit: "tokens", decimals: 0, total: 0, subscription: 0, topup: 0, dailySpent: 0, dailyLimit: null, monthlyAllocation: 0, appCreditsAllowance: 0, allowance: null },
    } as unknown as UserBalance
    const view = headerBalance(balance, "en")
    expect(view.total).toBeUndefined()
    expect(view.allowance).toBeFalsy()
    expect(view.display).toMatchObject({ total: null, subscription: 0, monthlyAllocation: 0 })
  })

  it("with a unit and no allowance: the converted balance, meter and welcome credits", () => {
    const balance = {
      ...BASE,
      welcomeOffer: { popupSeen: false, consentPending: false, credits: 100 },
      display: { unit: "tokens", decimals: 0, total: 1400000, subscription: 1200000, topup: 200000, dailySpent: 0, dailyLimit: null, monthlyAllocation: 4000000, appCreditsAllowance: 0, welcomeOffer: { credits: 400000 } },
    } as unknown as UserBalance
    const view = headerBalance(balance, "en")
    expect(view).toMatchObject({ total: 1400000, subscription: 1200000, monthlyAllocation: 4000000, welcomeOffer: { popupSeen: false, credits: 400000 } })
    expect(view.display).toMatchObject({ total: 1400000, subscription: 1200000, monthlyAllocation: 4000000 })
  })

  it("a converted figure the server could not give stays unknown", () => {
    const balance = { ...BASE, display: { unit: "tokens", decimals: 0, total: null, subscription: null, topup: null, dailySpent: null, dailyLimit: null, monthlyAllocation: null, appCreditsAllowance: null } } as unknown as UserBalance
    const view = headerBalance(balance, "en")
    expect(view.total).toBeUndefined()
    expect(view.monthlyAllocation).toBe(0)
    // The header reads `display` for its meter: an unknown month is an empty one, as the balance beside it says.
    expect(view.display).toMatchObject({ subscription: 0, monthlyAllocation: 0 })
  })

  it("the unit's word in the viewer's language: the word the server sent for it, else the single label", () => {
    const display = { unit: "tokens", unitLabels: { en: "tokens", he: "טוקנים" }, decimals: 0, total: 1400, subscription: 1200, topup: 200, dailySpent: 0, dailyLimit: null, monthlyAllocation: 4000, appCreditsAllowance: 0 }
    const balance = { ...BASE, display } as unknown as UserBalance
    expect(headerBalance(balance, "he").display?.unit).toBe("טוקנים")
    expect(headerBalance(balance, "en").display?.unit).toBe("tokens")
    expect(headerBalance(balance, "ja").display?.unit).toBe("tokens")
    // A figure from an outside wallet is worded the same way.
    const wallet = { ...BASE, externalWallet: { available: 420 }, display: { ...display, externalWallet: { available: 1680 } } } as unknown as UserBalance
    const view = headerBalance(wallet, "he")
    expect(view.display?.unit).toBe("טוקנים")
    expect(view).toMatchObject({ total: 1680, monthlyAllocation: 0 })
  })

  it("a balance in credits has no unit word to pick: as sent, by identity", () => {
    expect(headerBalance(BASE, "he")).toBe(BASE)
  })

  it("an outside wallet keeps its key: the header draws no meter beside it", () => {
    const balance = { ...BASE, externalWallet: { available: 420 }, allowance: { granted: 2000, remaining: 1500, enforced: true } } as UserBalance
    expect(headerBalance(balance, "en").externalWallet).toEqual({ available: 420 })
  })
})

describe("withHeaderBalance", () => {
  it("hands the header the balance view and leaves every other call alone", async () => {
    const credits = { client: { name: "core" }, balance: vi.fn(async () => ({ ...BASE, allowance: { granted: 10, remaining: 7, enforced: true } })), transactions: vi.fn(function (this: { client: { name: string } }) { return this.client.name }) }
    const sdk = { credits, me: { get: vi.fn() }, request: vi.fn() } as unknown as NodaroClient
    const header = withHeaderBalance(sdk, () => "en")
    await expect(header.credits.balance()).resolves.toMatchObject({ total: 7 })
    // Another credits call runs on the resource itself.
    expect((header.credits as unknown as { transactions: () => string }).transactions()).toBe("core")
    expect(header.me).toBe(sdk.me)
    expect(header.request).toBe(sdk.request)
  })
})

describe("unitTranslator", () => {
  const t = (key: string) => `shell:${key}`
  const words: UnitWords = {
    label: "tokens",
    balance: (credits) => `${credits} tokens`,
    pill: (credits) => `${credits} tokens, more`,
    loading: "Loading tokens",
    left: "tokens left",
    meter: (left, total) => `${left} of ${total} tokens`,
  }

  it("words the credit figures in the unit, and leaves every other key to the header", () => {
    const unit = unitTranslator(t, words)
    expect(unit("credits.label")).toBe("tokens")
    expect(unit("credits.balance", { credits: "1,500" })).toBe("1,500 tokens")
    expect(unit("credits.pill", { credits: "1,500" })).toBe("1,500 tokens, more")
    expect(unit("credits.loading")).toBe("Loading tokens")
    expect(unit("account.creditsLeft")).toBe("tokens left")
    expect(unit("account.monthMeter", { left: "5", total: "10" })).toBe("5 of 10 tokens")
    expect(unit("account.settings")).toBe("shell:account.settings")
  })

  it("words the header's own unit sentences too, so a deployment reads the app's words as before", () => {
    const unit = unitTranslator(t, words)
    expect(unit("credits.pillUnit", { amount: "1,500", unit: "tokens" })).toBe("1,500 tokens, more")
    expect(unit("credits.balanceUnit", { amount: "1,500", unit: "tokens" })).toBe("1,500 tokens")
    expect(unit("account.unitsLeft", { unit: "tokens" })).toBe("tokens left")
    expect(unit("account.monthMeterUnit", { unit: "tokens", left: "5", total: "10" })).toBe("5 of 10 tokens")
  })

  it("no unit: the header's own words", () => {
    expect(unitTranslator(t, null)).toBe(t)
  })
})
