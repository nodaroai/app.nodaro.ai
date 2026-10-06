import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const safeFetchMock = vi.fn()
vi.mock("../../../lib/safe-fetch.js", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}))

import { parseChannelHtml, parseChannelPage, normalizeChannel, fetchChannelPosts, fetchChannelPage } from "../telegram-channel.js"

// Mirrors the real t.me/s/ preview DOM. The text, photo, video, footer (views +
// date) and the SVG-less wrapper shape below were captured live from
// t.me/s/telegram and t.me/s/durov on 2026-10-06 (posts 441 / 452 / 528); the
// reply quote, the forwarded-from header and the album wrap are written from
// Telegram's class names (SYNTHETIC — no live sample carried one that day).
const FOOTER = (id: number, when: string, views: string) =>
  `<div class="tgme_widget_message_footer compact js-message_footer"> <div class="tgme_widget_message_info short js-message_info"> <span class="tgme_widget_message_views">${views}</span><span class="copyonly"> views</span><span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/acme/${id}"><time datetime="${when}" class="time">16:08</time></a></span> </div> </div>`

const FIXTURE = `
<div class="tgme_channel_info">...</div>
<div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="acme/10">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Hello &amp; <b>welcome</b> to Acme<br/>Second line</div>
  ${FOOTER(10, "2026-07-18T10:00:00+00:00", "1.52M")}
</div>
<div class="tgme_widget_message js-widget_message" data-post="acme/11">
  <a class="tgme_widget_message_photo_wrap 5109473995509140547 1189642119_460000323" href="https://t.me/acme/11" style="width:800px;background-image:url('https://cdn1.telesco.pe/file/pic11')"></a>
  <div class="tgme_widget_message_text js-message_text" dir="auto">Photo post &#128512;</div>
  ${FOOTER(11, "2026-07-18T11:00:00+00:00", "18.9K")}
</div>
<div class="tgme_widget_message js-widget_message" data-post="acme/12">
  <div class="tgme_widget_message_service">joined the channel</div>
</div>
<div class="tgme_widget_message js-widget_message" data-post="acme/13">
  <a class="tgme_widget_message_video_player js-message_video_player" href="https://t.me/acme/13"><i class="tgme_widget_message_video_thumb" style="background-image:url('https://cdn1.telesco.pe/file/poster13')"></i> <div class="tgme_widget_message_video_wrap" style="width:1920px;padding-top:100%"> <video src="https://cdn1.telesco.pe/file/c01503a63e.mp4?token=abc" class="tgme_widget_message_video js-message_video" width="100%" height="100%" muted autoplay loop playsinline></video> </div><time class="message_video_duration js-message_video_duration">0:06</time></a>
  <div class="tgme_widget_message_text js-message_text" dir="auto">Video post</div>
  ${FOOTER(13, "2026-07-18T13:00:00+00:00", "2.1M")}
</div>
<div class="tgme_widget_message js-widget_message" data-post="acme/14">
  <a class="tgme_widget_message_video_player not_supported js-message_video_player" href="https://t.me/acme/14"><i class="tgme_widget_message_video_thumb" style="background-image:url('https://cdn1.telesco.pe/file/poster14')"></i><div class="message_video_play"></div><div class="message_media_not_supported_label">Watch in Telegram</div></a>
  ${FOOTER(14, "2026-07-18T14:00:00+00:00", "900")}
</div>
<div class="tgme_widget_message js-widget_message" data-post="acme/15">
  <a class="tgme_widget_message_reply" href="https://t.me/acme/10"><div class="tgme_widget_message_author"><span class="tgme_widget_message_author_name" dir="auto">Acme</span></div><div class="tgme_widget_message_text js-message_reply_text" dir="auto">Hello &amp; welcome to Acme</div></a>
  <div class="tgme_widget_message_text js-message_text" dir="auto">Replying to the welcome</div>
  ${FOOTER(15, "2026-07-18T15:00:00+00:00", "100")}
</div>
<div class="tgme_widget_message js-widget_message" data-post="acme/16">
  <div class="tgme_widget_message_forwarded_from accent_color"><span class="tgme_widget_message_forwarded_from_label">Forwarded from</span> <a class="tgme_widget_message_forwarded_from_name" href="https://t.me/othernews/77"><span dir="auto">Other &amp; News</span></a></div>
  <div class="tgme_widget_message_grouped_wrap js-message_grouped_wrap"><div class="tgme_widget_message_grouped js-message_grouped"><a class="tgme_widget_message_photo_wrap grouped_media_wrap" href="https://t.me/acme/16?single" style="background-image:url('https://cdn1.telesco.pe/file/album16a')"></a><a class="tgme_widget_message_photo_wrap grouped_media_wrap" href="https://t.me/acme/16?single" style="background-image:url('https://cdn1.telesco.pe/file/album16b')"></a></div></div>
  <div class="tgme_widget_message_text js-message_text" dir="auto">Two pictures</div>
  ${FOOTER(16, "2026-07-18T16:00:00+00:00", "5")}
</div>
<div class="tgme_widget_message js-widget_message" data-post="acme/17">
  <div class="tgme_widget_message_forwarded_from accent_color"><span class="tgme_widget_message_forwarded_from_label">Forwarded from</span> <span class="tgme_widget_message_forwarded_from_name"><span dir="auto">Someone Private</span></span></div>
  <div class="tgme_widget_message_text js-message_text" dir="auto">From a private sender</div>
  ${FOOTER(17, "2026-07-18T17:00:00+00:00", "6")}
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
  const byId = Object.fromEntries(posts.map((p) => [p.id, p]))

  it("extracts text posts with decoded entities and stripped HTML, the link, the date and the views", () => {
    expect(byId[10]).toMatchObject({
      channel: "acme",
      postUrl: "https://t.me/acme/10",
      text: "Hello & welcome to Acme\nSecond line",
      date: "2026-07-18T10:00:00+00:00",
      views: "1.52M",
      media: [],
    })
    expect(byId[10]!.imageUrl).toBeUndefined()
  })

  it("a photo post: the photo in media, as the first picture, with decoded emoji", () => {
    expect(byId[11]).toMatchObject({
      text: "Photo post 😀",
      media: [{ type: "photo", url: "https://cdn1.telesco.pe/file/pic11" }],
      imageUrl: "https://cdn1.telesco.pe/file/pic11",
    })
  })

  it("a video post: the file and its poster; the poster is the picture; the duration <time> is not the date", () => {
    expect(byId[13]).toMatchObject({
      text: "Video post",
      media: [{ type: "video", url: "https://cdn1.telesco.pe/file/c01503a63e.mp4?token=abc", posterUrl: "https://cdn1.telesco.pe/file/poster13" }],
      imageUrl: "https://cdn1.telesco.pe/file/poster13",
      date: "2026-07-18T13:00:00+00:00",
    })
  })

  it("a 'Watch in Telegram' video has a poster and no file — and a post with media but no text is kept", () => {
    expect(byId[14]).toMatchObject({ text: "", media: [{ type: "video", posterUrl: "https://cdn1.telesco.pe/file/poster14" }] })
    expect(byId[14]!.media[0]).not.toHaveProperty("url")
  })

  it("a reply: the post's OWN text, never the quoted text (synthetic markup)", () => {
    expect(byId[15]!.text).toBe("Replying to the welcome")
  })

  it("an album of two photos, forwarded from a channel with a link (synthetic markup)", () => {
    expect(byId[16]).toMatchObject({
      text: "Two pictures",
      forwardedFrom: { name: "Other & News", url: "https://t.me/othernews/77" },
      media: [
        { type: "photo", url: "https://cdn1.telesco.pe/file/album16a" },
        { type: "photo", url: "https://cdn1.telesco.pe/file/album16b" },
      ],
      imageUrl: "https://cdn1.telesco.pe/file/album16a",
    })
  })

  it("forwarded from a sender without a link — the <span> form (synthetic markup)", () => {
    expect(byId[17]!.forwardedFrom).toEqual({ name: "Someone Private" })
  })

  it("skips service messages with no text or media", () => {
    expect(byId[12]).toBeUndefined()
  })

  it("returns posts ascending by id", () => {
    expect(posts.map((p) => p.id)).toEqual([10, 11, 13, 14, 15, 16, 17])
  })
})

describe("entities a post can carry", () => {
  const wrap = (id: number, text: string) =>
    `<div class="tgme_widget_message js-widget_message" data-post="acme/${id}"><div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>${FOOTER(id, "2026-07-18T10:00:00+00:00", "1")}</div>`

  it("an out-of-range numeric entity stays as written instead of failing the whole page (one such post failed every tick)", () => {
    const posts = parseChannelHtml(wrap(20, "Score &#9999999; and &#x110000; today &#128512;"), "acme")
    expect(posts).toHaveLength(1)
    expect(posts[0]!.text).toBe("Score &#9999999; and &#x110000; today 😀")
  })

  it("&amp; is decoded last, so an escaped entity reads as the text the author wrote", () => {
    const posts = parseChannelHtml(wrap(21, "Type &amp;lt; for less-than, &amp;amp; for an ampersand"), "acme")
    expect(posts[0]!.text).toBe("Type &lt; for less-than, &amp; for an ampersand")
  })

  it("the bidi marks and the other named entities a Hebrew channel carries decode to their characters; an unknown name stays", () => {
    const posts = parseChannelHtml(wrap(22, "&rlm;Speech&lrm; זמין &hellip; A &mdash; B &laquo;q&raquo; &unknownthing; &constructor;"), "acme")
    expect(posts[0]!.text).toBe("‏Speech‎ זמין … A — B «q» &unknownthing; &constructor;")
  })

  it("a video player with neither a file nor a poster yet yields no medium; the post is kept for its text", () => {
    const html = `<div class="tgme_widget_message js-widget_message" data-post="acme/23"><a class="tgme_widget_message_video_player js-message_video_player" href="https://t.me/acme/23"><div class="message_video_play"></div></a><div class="tgme_widget_message_text js-message_text" dir="auto">Fresh video</div>${FOOTER(23, "2026-07-18T10:00:00+00:00", "1")}</div>`
    const posts = parseChannelHtml(html, "acme")
    expect(posts).toHaveLength(1)
    expect(posts[0]!.media).toEqual([])
    expect(posts[0]!.imageUrl).toBeUndefined()
  })
})

describe("parseChannelPage / fetchChannelPage — the highest id the page rendered", () => {
  it("counts posts with nothing to read (the service message), so the position can move past them", () => {
    const page = parseChannelPage(FIXTURE, "acme")
    expect(page.posts.map((p) => p.id)).toEqual([10, 11, 13, 14, 15, 16, 17])
    expect(page.maxSeenId).toBe(17)
    const onlyUnreadable = parseChannelPage(
      `<div class="tgme_channel_info">...</div><div class="tgme_widget_message js-widget_message" data-post="acme/30"><div class="tgme_widget_message_service">joined</div></div><div class="tgme_widget_message js-widget_message" data-post="acme/31"><div class="tgme_widget_message_service">pinned</div></div>`,
      "acme",
    )
    expect(onlyUnreadable.posts).toEqual([])
    expect(onlyUnreadable.maxSeenId).toBe(31)
  })

  it("paging after a post: only ids above it count, for the posts and for the page's highest id", async () => {
    safeFetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => FIXTURE })
    const page = await fetchChannelPage("acme", { after: 14 })
    expect(page.posts.map((p) => p.id)).toEqual([15, 16, 17])
    expect(page.maxSeenId).toBe(17)
    safeFetchMock.mockResolvedValueOnce({ ok: true, status: 200, text: async () => FIXTURE })
    const past = await fetchChannelPage("acme", { after: 17 })
    expect(past.posts).toEqual([])
    expect(past.maxSeenId).toBeUndefined()
  })
})

describe("fetchChannelPosts", () => {
  beforeEach(() => safeFetchMock.mockReset())
  afterEach(() => safeFetchMock.mockReset())

  it("fetches t.me/s/<channel> and returns parsed posts", async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => FIXTURE })
    const posts = await fetchChannelPosts("@acme")
    expect(safeFetchMock).toHaveBeenCalledWith("https://t.me/s/acme", expect.any(Object))
    expect(posts.map((p) => p.id)).toEqual([10, 11, 13, 14, 15, 16, 17])
  })

  it("pages forward with ?after=<id> and keeps only what lies above it", async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => FIXTURE })
    const posts = await fetchChannelPosts("acme", { after: 13 })
    expect(safeFetchMock).toHaveBeenCalledWith("https://t.me/s/acme?after=13", expect.any(Object))
    expect(posts.map((p) => p.id)).toEqual([14, 15, 16, 17])
  })

  it("an empty page past the newest post (channel markup, no posts) is nothing new, not an error", async () => {
    safeFetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => `<div class="tgme_channel_info">...</div><section class="tgme_channel_history js-message_history"></section>` })
    await expect(fetchChannelPosts("acme", { after: 999 })).resolves.toEqual([])
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
