/**
 * The topic client calls as they are (no mocked client): a server without
 * the routes, a server not ready for them, a delete answered with an empty
 * 204, and the refusals the topic routes share with the brand routes, worded
 * for a topic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getSession: mockGetSession },
  }),
}))

import { createTopic, deleteOrAlreadyGone, deleteTopic, isNotFoundError, isNotReadyError, listTopics, scanTopic } from "../api"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"

/** A fetch answer: `body` as its JSON, or a body that is not JSON at all. */
function answer(status: number, body?: unknown, opts: { readonly notJson?: boolean } = {}) {
  const json = vi.fn(() => (opts.notJson || body === undefined ? Promise.reject(new SyntaxError("Unexpected end of JSON input")) : Promise.resolve(body)))
  return { ok: status >= 200 && status < 300, status, json, text: () => Promise.resolve(body === undefined ? "" : JSON.stringify(body)) }
}

function stubFetch(res: ReturnType<typeof answer>) {
  const fetch = vi.fn().mockResolvedValue(res)
  vi.stubGlobal("fetch", fetch)
  return fetch
}

async function rejection(promise: Promise<unknown>): Promise<Error & { code?: string; serverMessage?: string }> {
  try {
    await promise
  } catch (err) {
    return err as Error & { code?: string; serverMessage?: string }
  }
  throw new Error("did not throw")
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetSession.mockResolvedValue({ data: { session: null } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useLocaleStore.setState({ locale: "en" })
})

describe("listTopics", () => {
  it("reads the list", async () => {
    const list = { data: [], limits: { topics: 10 }, historyMonths: 3 }
    const fetch = stubFetch(answer(200, list))
    await expect(listTopics()).resolves.toEqual(list)
    expect(fetch).toHaveBeenCalledWith("/v1/topics", expect.objectContaining({ method: "GET" }))
  })

  it("is null on a server without the topic routes (its own 404)", async () => {
    stubFetch(answer(404, { message: "Route GET:/v1/topics not found", error: "Not Found", statusCode: 404 }))
    await expect(listTopics()).resolves.toBeNull()
  })

  it("keeps the code of a server not ready for topics", async () => {
    stubFetch(answer(503, { error: { code: "not_ready", message: "Topics are not available yet." } }))
    const err = await rejection(listTopics())
    expect(err.code).toBe("not_ready")
    expect(isNotReadyError(err)).toBe(true)
    expect(err.message).toBe("Topics are not available yet.")
  })

  it("says the answer was not what was expected when a 200 is not JSON", async () => {
    stubFetch(answer(200, undefined, { notJson: true }))
    const err = await rejection(listTopics())
    expect(err.message).toBe(translate("en", "apiErr.unexpectedResponse", { context: translate("en", "apiErr.loadTopics") }))
    expect(isNotReadyError(err)).toBe(false)
  })
})

describe("deleteTopic", () => {
  it("resolves on an empty 204, without reading a body", async () => {
    const res = answer(204)
    const fetch = stubFetch(res)
    await expect(deleteTopic("t1")).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith("/v1/topics/t1", expect.objectContaining({ method: "DELETE" }))
    expect(res.json).not.toHaveBeenCalled()
  })

  it("keeps not_found, so a topic already gone counts as removed", async () => {
    stubFetch(answer(404, { error: { code: "not_found", message: "Topic not found" } }))
    const err = await rejection(deleteTopic("t1"))
    expect(isNotFoundError(err)).toBe(true)
    stubFetch(answer(404, { error: { code: "not_found", message: "Topic not found" } }))
    await expect(deleteOrAlreadyGone(deleteTopic("t1"))).resolves.toBeUndefined()
  })
})

describe("a refusal the topic routes share with the brand routes", () => {
  it("keeps the server's words in English", async () => {
    stubFetch(answer(409, { error: { code: "already_tracked", message: "You already track this topic." } }))
    const err = await rejection(createTopic({ name: "Example topic" }))
    expect(err.message).toBe("You already track this topic.")
    expect(err.code).toBe("already_tracked")
  })

  it("names a topic, not a brand, in another language", async () => {
    useLocaleStore.setState({ locale: "he" })
    stubFetch(answer(409, { error: { code: "already_tracked", message: "You already track this topic." } }))
    const tracked = await rejection(createTopic({ name: "Example topic" }))
    expect(tracked.message).toBe(
      translate("he", "apiErr.withReason", { context: translate("he", "apiErr.saveTopic"), reason: translate("he", "apiErr.reason.topicAlreadyTracked") }),
    )
    expect(tracked.code).toBe("already_tracked")
    expect(tracked.serverMessage).toBe("You already track this topic.")

    useLocaleStore.setState({ locale: "ja" })
    stubFetch(answer(409, { error: { code: "scan_running", message: "A scan of this topic is running." } }))
    const running = await rejection(scanTopic("t1"))
    expect(running.message).toBe(
      translate("ja", "apiErr.withReason", { context: translate("ja", "apiErr.scanTopic"), reason: translate("ja", "apiErr.reason.topicScanRunning") }),
    )
  })
})
