import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// safeFetch (media download) + global fetch (Telegram API) are both scripted.
const safeFetchMock = vi.fn()
vi.mock("../../../../lib/safe-fetch.js", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}))

let apiCalls: Array<{ url: string; form: FormData }> = []
const realFetch = globalThis.fetch
beforeEach(() => {
  apiCalls = []
  safeFetchMock.mockReset()
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    apiCalls.push({ url: String(url), form: init?.body as FormData })
    return {
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 555 } }),
    } as Response
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
})

import { telegramPublisher } from "../telegram.js"

function mediaResponse(bytes: number, contentLength?: string): Response {
  return {
    ok: true,
    statusText: "OK",
    headers: { get: (h: string) => (h === "content-length" ? contentLength ?? null : null) },
    // A real Blob so FormData.append accepts it (size drives the >50MB guard).
    blob: async () => new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }),
  } as unknown as Response
}

describe("telegram send-audio", () => {
  it("downloads via safeFetch and POSTs sendAudio with the caption", async () => {
    safeFetchMock.mockResolvedValue(mediaResponse(1024, "1024"))

    const res = await telegramPublisher.publish(
      "bot-token",
      { action: "send-audio", mediaUrl: "https://cdn.test/track.mp3", caption: "**new track**" },
      { chatId: "@mychan" },
    )

    expect(res).toEqual({ success: true, platformPostId: "555" })
    expect(safeFetchMock).toHaveBeenCalledWith("https://cdn.test/track.mp3")
    const call = apiCalls.at(-1)!
    expect(call.url).toContain("/sendAudio")
    expect(call.form.get("chat_id")).toBe("@mychan")
    expect(call.form.get("audio")).toBeTruthy()
    // markdown → Telegram HTML
    expect(call.form.get("caption")).toContain("<b>new track</b>")
  })

  it("requires a mediaUrl", async () => {
    await expect(
      telegramPublisher.publish("t", { action: "send-audio" }, { chatId: "@c" }),
    ).rejects.toThrow(/mediaUrl is required/)
  })

  it("rejects audio over the 50MB Telegram limit (by content-length)", async () => {
    safeFetchMock.mockResolvedValue(mediaResponse(0, String(51 * 1024 * 1024)))
    const res = await telegramPublisher.publish(
      "t",
      { action: "send-audio", mediaUrl: "https://cdn.test/huge.mp3" },
      { chatId: "@c" },
    )
    expect(res).toEqual({ success: false, error: "Audio exceeds Telegram 50MB limit" })
  })

  it("surfaces a Telegram API failure", async () => {
    safeFetchMock.mockResolvedValue(mediaResponse(1024, "1024"))
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: false, description: "CHAT_NOT_FOUND" }) }) as Response) as typeof fetch
    const res = await telegramPublisher.publish(
      "t",
      { action: "send-audio", mediaUrl: "https://cdn.test/a.mp3" },
      { chatId: "@c" },
    )
    expect(res).toEqual({ success: false, error: "CHAT_NOT_FOUND" })
  })
})
