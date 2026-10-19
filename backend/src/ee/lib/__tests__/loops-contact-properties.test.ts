import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config.js", () => ({ config: { LOOPS_API_KEY: "test-key" } }))
vi.mock("@/ee/lib/loops-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../loops-client.js")>()),
  isLoopsConfigured: vi.fn(() => true),
  listCustomContactProperties: vi.fn(),
  createContactProperty: vi.fn(),
}))

import { createPropertyEnsurer, languageProperty } from "../loops-contact-properties.js"
import { isLoopsConfigured, listCustomContactProperties, createContactProperty } from "../loops-client.js"

const list = vi.mocked(listCustomContactProperties)
const create = vi.mocked(createContactProperty)

const PLAN = { key: "plan", label: "Plan", type: "string" }
const LANGUAGE = { key: "language", label: "Language", type: "string" }
const LANGUAGE_AS_NUMBER = { key: "language", label: "Language", type: "number" }
const listing = (...properties: Array<typeof PLAN>) => ({ ok: true, status: 200, properties })
const FAILED_LIST = { ok: false, status: 500, error: "boom", properties: null }
const ALREADY_EXISTS = { ok: false, status: 400, error: '{"success":false,"message":"Property already exists."}' }

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isLoopsConfigured).mockReturnValue(true)
  warn = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  warn.mockRestore()
})

describe("createPropertyEnsurer", () => {
  it("confirms a property the account already has — without creating it", async () => {
    list.mockResolvedValue(listing(PLAN, LANGUAGE) as never)
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })

  it("creates a missing property as the type it was asked for", async () => {
    list.mockResolvedValue(listing(PLAN) as never)
    create.mockResolvedValue({ ok: true, status: 200 })
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith("language", "string")
  })

  it("asks Loops once and remembers a success", async () => {
    list.mockResolvedValue(listing(LANGUAGE) as never)
    const ensurer = createPropertyEnsurer("language", "string")
    expect(await ensurer.ensure()).toBe(true)
    expect(await ensurer.ensure()).toBe(true)
    expect(await ensurer.ensure()).toBe(true)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it("shares one attempt between callers that arrive together", async () => {
    list.mockResolvedValue(listing(PLAN) as never)
    create.mockResolvedValue({ ok: true, status: 200 })
    const ensurer = createPropertyEnsurer("language", "string")
    const answers = await Promise.all([ensurer.ensure(), ensurer.ensure(), ensurer.ensure()])
    expect(answers).toEqual([true, true, true])
    expect(list).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it("trusts the account's list, not the wording of a refusal, when another process created it first", async () => {
    list.mockResolvedValueOnce(listing(PLAN) as never).mockResolvedValueOnce(listing(PLAN, LANGUAGE) as never)
    create.mockResolvedValue(ALREADY_EXISTS)
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(true)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it("answers false, and says why, when a refused create cannot be reconciled", async () => {
    list.mockResolvedValue(listing(PLAN) as never)
    create.mockResolvedValue({ ok: false, status: 400, error: "reserved name" })
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("language")
  })

  it("does not accept a property of the same name with another type, and says so", async () => {
    // Loops would refuse every string we then sent it, and the row would never sync.
    list.mockResolvedValue(listing(LANGUAGE_AS_NUMBER) as never)
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain("number")
  })

  it("does not accept a wrong-typed property that shows up after a refused create either", async () => {
    list.mockResolvedValueOnce(listing(PLAN) as never).mockResolvedValueOnce(listing(LANGUAGE_AS_NUMBER) as never)
    create.mockResolvedValue(ALREADY_EXISTS)
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(false)
    expect(String(warn.mock.calls[0][0])).toContain("number")
  })

  it("creates nothing when it could not read the account's properties", async () => {
    list.mockResolvedValue(FAILED_LIST as never)
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(false)
    expect(create).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("never throws", async () => {
    list.mockRejectedValue(new Error("socket hang up"))
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(false)

    list.mockResolvedValue(listing(PLAN) as never)
    create.mockRejectedValue(new Error("socket hang up"))
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(false)
  })

  it("waits before asking again after a failure, and then recovers", async () => {
    vi.useFakeTimers()
    list.mockResolvedValueOnce(FAILED_LIST as never).mockResolvedValue(listing(LANGUAGE) as never)
    const ensurer = createPropertyEnsurer("language", "string")

    expect(await ensurer.ensure()).toBe(false)
    expect(await ensurer.ensure()).toBe(false) // inside the wait: no new request
    expect(list).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
    expect(await ensurer.ensure()).toBe(true)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it("asks again after forget() — the property may have been removed from the account", async () => {
    list.mockResolvedValue(listing(LANGUAGE) as never)
    const ensurer = createPropertyEnsurer("language", "string")
    await ensurer.ensure()
    ensurer.forget()
    expect(await ensurer.ensure()).toBe(true)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it("is false and silent when Loops is not configured", async () => {
    vi.mocked(isLoopsConfigured).mockReturnValue(false)
    expect(await createPropertyEnsurer("language", "string").ensure()).toBe(false)
    expect(list).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe("languageProperty", () => {
  // Kept last: it is the module's one shared instance, and this is the only
  // test that touches it.
  it("is the string property the consent sync writes the customer's language to", async () => {
    list.mockResolvedValue(listing(PLAN) as never)
    create.mockResolvedValue({ ok: true, status: 200 })
    expect(await languageProperty.ensure()).toBe(true)
    expect(create).toHaveBeenCalledWith("language", "string")
  })
})
