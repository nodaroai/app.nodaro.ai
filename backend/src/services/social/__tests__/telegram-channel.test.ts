import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const safeFetchMock = vi.fn()
vi.mock("../../../lib/safe-fetch.js", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}))

import { parseChannelHtml, normalizeChannel, fetchChannelPosts } from "../telegram-channel.js"

// Mirrors the real t.me/s/ preview DOM (verified 2026-07-19): a
// .tgme_widget_message wrapper with data-post="chan/<id>", an inner
// .tgme_widget_message_text, a photo wrap with background-image:url('…'), and a
// <time datetime="…">.
const FIXTURE = `
<div class="tgme_channel_info">...</div>
<div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="acme/10">
  <div class="tgme_widget_message_text js-message_text">Hello &amp; <b>welcome</b> to Acme<br/>Second line</div>
  <time datetime="2026-07-18T10:00:00+00:00"></time>
</div>
<div class="tgme_widget_message js-widget_message" data-post="acme/11">
  <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn.telesco.pe/file/pic11')"></a>
  <div class="tgme_widget_message_text js-message_text">Photo post &#128512;</div>
  <time datetime="2026-07-18T11:00:00+00:00"></time>
</div>
<div class="tgme_widget_message js-widget_message" data-post="acme/12">
  <div class="tgme_widget_message_service">joined the channel</div>
</div>
`

describe("normalizeChannel", () => {
  it("strips @, t.me/, /s/, and validates the id", () => {
    expect(normalizeChannel("@Durov")).toBe("Durov")
    expect(normalizeChannel("https://t.me/s/durov")).toBe("durov")
    expect(normalizeChannel("t.me/acme_news")).toBe("acme_news")
    expect(normalizeChannel("  durov  ")).toBe("durov")
    expect(normalizeChannel("bad name!")).toBeNull()
    expect(normalizeChannel("ab")).toBeNull() // too short
  })
})

describe("parseChannelHtml", () => {
  const posts = parseChannelHtml(FIXTURE, "acme")

  it("extracts text posts with decoded entities and stripped HTML", () => {
    const p10 = posts.find((p) => p.id === 10)!
    expect(p10.text).toBe("Hello & welcome to Acme\nSecond line")
    expect(p10.url).toBe("https://t.me/acme/10")
    expect(p10.date).toBe("2026-07-18T10:00:00+00:00")
    expect(p10.imageUrl).toBeUndefined()
  })

  it("extracts the photo URL and decodes emoji entities", () => {
    const p11 = posts.find((p) => p.id === 11)!
    expect(p11.imageUrl).toBe("https://cdn.telesco.pe/file/pic11")
    expect(p11.text).toBe("Photo post 😀")
  })

  it("skips service messages with no text or image", () => {
    expect(posts.find((p) => p.id === 12)).toBeUndefined()
  })

  it("returns posts ascending by id", () => {
    expect(posts.map((p) => p.id)).toEqual([10, 11])
  })
})

describe("fetchChannelPosts", () => {
  beforeEach(() => safeFetchMock.mockReset())
  afterEach(() => safeFetchMock.mockReset())

  it("fetches t.me/s/<channel> and returns parsed posts", async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => FIXTURE })
    const posts = await fetchChannelPosts("@acme")
    expect(safeFetchMock).toHaveBeenCalledWith("https://t.me/s/acme", expect.any(Object))
    expect(posts.map((p) => p.id)).toEqual([10, 11])
  })

  it("rejects an invalid channel name before fetching", async () => {
    await expect(fetchChannelPosts("bad name!")).rejects.toThrow(/not a valid Telegram channel/)
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it("gives a clear error for a private / preview-disabled channel (page has no messages)", async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "<html><body>no preview</body></html>" })
    await expect(fetchChannelPosts("secret")).rejects.toThrow(/private, doesn't exist, or has its web preview disabled/)
  })
})
