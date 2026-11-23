/**
 * The share card's content and HTML (lib/share-links/card.ts): the title is
 * the result's own name and the tool that made it, the description one line
 * in the link's language, the picture only ever ours (never a provider's
 * address), the media tags only for our own files; the tags say what the link
 * shows and nothing more, every value is escaped, the tags come first in the
 * head, people are sent on to the share page, and the share site's origin is
 * read safely.
 */
import { describe, it, expect } from "vitest"
import {
  clip,
  escapeHtml,
  jobCardContent,
  mediaTypeOf,
  projectCardContent,
  sessionCardContent,
  shareCardHtml,
  shareCardNotFoundHtml,
  shareSiteOriginOf,
  withCardImage,
  type CardSources,
} from "../card.js"
import type { SharedJob } from "../types.js"

const OURS = "https://cdn.example/"
const SOURCES: CardSources = { isOurs: (url) => url.startsWith(OURS) }

const PLACE = {
  cardUrl: "https://share.example/s/TOKEN",
  pageUrl: "https://share.example/shared/TOKEN",
  defaultImage: { url: "https://app.example/share-card.jpg", width: 1200, height: 630, type: "image/jpeg" },
}

const RENDERED = { url: "https://cdn.example/share-cards/abc/def.jpg", width: 1200, height: 630, type: "image/jpeg" }

function job(over: Partial<SharedJob> = {}): SharedJob {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    type: "generate-image",
    mediaKind: "image",
    outputUrl: "https://cdn.example/images/a1.png",
    width: 1920,
    height: 1080,
    title: null,
    toolName: "Image Generation",
    coverUrl: null,
    createdAt: "2026-11-19T10:00:00Z",
    prompt: "a red car on a beach at sunset",
    displayPrompt: "a red car on a beach at sunset",
    model: { id: "nano-banana-pro", name: "Nano Banana Pro" },
    settings: {},
    ...over,
  }
}

const song = (over: Partial<SharedJob> = {}): SharedJob =>
  job({
    type: "suno-mashup",
    toolName: "Song Mashup",
    mediaKind: "audio",
    outputUrl: "https://cdn.example/audios/s.mp3",
    width: undefined,
    height: undefined,
    prompt: "blend these two",
    displayPrompt: "blend these two",
    ...over,
  })

/** The content of every `<meta property|name=… content=…>`, by key. */
function tags(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)">/g)) out[m[1]!] = m[2]!
  return out
}

describe("the title: the result's own name and its tool", () => {
  it("the owner's name, else the trend's, else the song's, else the start of the prompt; then the tool", () => {
    expect(jobCardContent(job({ title: "Red car" }), {}, SOURCES).title).toBe("Red car · Image Generation")
    expect(jobCardContent(job(), {}, SOURCES).title).toBe("a red car on a beach at sunset · Image Generation")
    expect(jobCardContent(song({ songTitle: "Lady's on the Loose" }), {}, SOURCES).title).toBe("Lady's on the Loose · Song Mashup")
    // The owner's own name wins over the song's.
    expect(jobCardContent(song({ songTitle: "Lady's on the Loose", title: "Mine" }), {}, SOURCES).title).toBe("Mine · Song Mashup")
  })

  it("never the generic sentence when anything better exists; the line itself when nothing does", () => {
    expect(jobCardContent(job({ prompt: null, displayPrompt: null }), {}, SOURCES).title).toBe("Image Generation")
    expect(jobCardContent(job({ prompt: null, displayPrompt: null, toolName: null, type: "plugin-thing" }), {}, SOURCES).title).toBe(
      "A picture made with Nodaro",
    )
  })

  it("reads the prompt as a person does: the pills' names, never the raw tokens; a long one is cut", () => {
    const content = jobCardContent(job({ prompt: "@image-1:1 Viral launch", displayPrompt: "@Image 1 Viral launch" }), {}, SOURCES)
    expect(content.title).toBe("@Image 1 Viral launch · Image Generation")
    const long = jobCardContent(job({ prompt: "word ".repeat(100), displayPrompt: "word ".repeat(100) }), {}, SOURCES)
    expect(Array.from(long.title).length).toBeLessThanOrEqual(90)
    expect(long.title).toContain("… · Image Generation")
  })

  it("a trend run: the trend's name, never a prompt", () => {
    const content = jobCardContent(
      job({ type: "cast-swap", toolName: "Video Remake", mediaKind: "video", prompt: null, displayPrompt: null, trend: { slug: "office-dance", name: "Office Dance" } }),
      {},
      SOURCES,
    )
    expect(content.title).toBe("Office Dance · Video Remake")
    expect(content.description).toBe("Made with the Office Dance trend on Nodaro")
  })
})

describe("the description: what it is, made with Nodaro, in the link's language", () => {
  it("one line by the kind of work", () => {
    expect(jobCardContent(job(), {}, SOURCES).description).toBe("A picture made with Nodaro")
    expect(jobCardContent(song(), {}, SOURCES).description).toBe("A song made with Nodaro")
    expect(jobCardContent(song({ type: "text-to-speech", toolName: "Text to Speech" }), {}, SOURCES).description).toBe("A voice recording made with Nodaro")
    expect(jobCardContent(song({ type: "text-to-audio", toolName: "Sound Effect" }), {}, SOURCES).description).toBe("A sound effect made with Nodaro")
    expect(jobCardContent(job({ mediaKind: "video", type: "image-to-video" }), {}, SOURCES).description).toBe("A video made with Nodaro")
    // A voice changer run on a video made a video.
    expect(jobCardContent(job({ mediaKind: "video", type: "voice-changer" }), {}, SOURCES).description).toBe("A video made with Nodaro")
  })

  it("in the language the link was shared in", () => {
    expect(jobCardContent(song(), {}, SOURCES, "he").description).toBe("שיר שנוצר עם Nodaro")
    expect(jobCardContent(song(), {}, SOURCES, "de").description).toBe("Ein mit Nodaro erstellter Song")
    expect(jobCardContent(song(), {}, SOURCES, "pt-BR").description).toBe("Uma música criada com o Nodaro")
    expect(jobCardContent(song(), {}, SOURCES, "ja").description).toBe("Nodaroで作成した曲")
    expect(sessionCardContent("Beach", 3, [], SOURCES, "es").description).toBe("3 resultados creados con Nodaro")
    expect(sessionCardContent("Beach", 1, [], SOURCES, "en").description).toBe("1 result made with Nodaro")
    expect(projectCardContent("Holiday", 2, [], SOURCES, "ko").description).toBe("Nodaro로 만든 세션 2개")
  })
})

describe("the picture: what the card's own picture shows, and the best one already ours", () => {
  it("a picture: itself; ours, it is the fallback with its size and type", () => {
    const content = jobCardContent(job(), {}, SOURCES)
    expect(content.picture).toEqual({ kind: "picture", source: "https://cdn.example/images/a1.png" })
    expect(content.fallbackImage).toEqual({ url: "https://cdn.example/images/a1.png", width: 1920, height: 1080, type: "image/png" })
    // Another host's picture is drawn from, but never named.
    expect(jobCardContent(job({ outputUrl: "https://files.provider.example/a.png" }), {}, SOURCES).fallbackImage).toBeNull()
  })

  it("a video: its poster (the owner's cover first), else our own video to take a frame from", () => {
    const video = job({ mediaKind: "video", type: "image-to-video", outputUrl: "https://cdn.example/videos/v.mp4" })
    expect(jobCardContent(video, { thumbnailUrl: "https://cdn.example/images/t.jpg" }, SOURCES).picture).toEqual({
      kind: "video",
      poster: "https://cdn.example/images/t.jpg",
      video: "https://cdn.example/videos/v.mp4",
    })
    expect(jobCardContent({ ...video, coverUrl: "https://cdn.example/job-covers/u/p.png" }, { thumbnailUrl: "https://cdn.example/images/t.jpg" }, SOURCES).picture).toMatchObject({
      poster: "https://cdn.example/job-covers/u/p.png",
    })
    expect(jobCardContent(video, {}, SOURCES).picture).toEqual({ kind: "video", poster: null, video: "https://cdn.example/videos/v.mp4" })
  })

  it("a sound: its art (the job's cover first) and its own name to draw", () => {
    const content = jobCardContent(song({ songTitle: "Lady's on the Loose", coverUrl: "https://musicfile.provider.example/c.jpeg" }), {}, SOURCES)
    expect(content.picture).toEqual({ kind: "sound", art: "https://musicfile.provider.example/c.jpeg", title: "Lady's on the Loose", work: "song" })
    // A provider's art is never named on the card itself.
    expect(content.fallbackImage).toBeNull()
    expect(jobCardContent(song(), { sunoImageUrl: "https://cdn.example/images/c.jpeg" }, SOURCES).fallbackImage).toEqual({
      url: "https://cdn.example/images/c.jpeg",
      type: "image/jpeg",
    })
    // A prompt is never drawn on the picture.
    expect(jobCardContent(song(), {}, SOURCES).picture).toMatchObject({ title: null })
  })

  it("never an address that is not https, or one the caller refuses", () => {
    expect(jobCardContent(song(), { imageUrl: "http://covers.example/c.jpeg" }, SOURCES).picture).toMatchObject({ art: null })
    expect(jobCardContent(song(), { imageUrl: "https://covers.example/c.jpeg" }, { ...SOURCES, refuse: () => true }).picture).toMatchObject({ art: null })
    expect(jobCardContent(job(), {}, { ...SOURCES, refuse: () => true }).picture).toBeNull()
  })

  it("a session or a project: a grid of its first pictures (at most four)", () => {
    const urls = ["https://cdn.example/a.png", "https://x.example/b.png", "https://cdn.example/c.png", "https://cdn.example/d.png", "https://cdn.example/e.png"]
    const session = sessionCardContent("Beach", 5, urls, SOURCES)
    expect(session.picture).toEqual({ kind: "grid", sources: urls.slice(0, 4) })
    expect(session.fallbackImage).toEqual({ url: "https://cdn.example/a.png", type: "image/png" })
    expect(sessionCardContent(null, 0, [], SOURCES)).toMatchObject({ title: "0 results made with Nodaro", picture: { kind: "grid", sources: [] }, fallbackImage: null })
    expect(projectCardContent("Holiday", 2, [urls[1]!], SOURCES)).toMatchObject({ title: "Holiday", fallbackImage: null })
  })
})

describe("shareCardHtml", () => {
  it("the tags first in the head (charset, title, then Open Graph and Twitter), the shared address as og:url and canonical", () => {
    const { html } = shareCardHtml(withCardImage(jobCardContent(job({ title: "Red car" }), {}, SOURCES), RENDERED), PLACE)
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"))
    const lines = head.split("\n").slice(1)
    expect(lines[0]).toBe('<meta charset="utf-8">')
    expect(lines[1]).toBe("<title>Red car · Image Generation — Nodaro</title>")
    expect(lines[2]).toBe('<meta property="og:title" content="Red car · Image Generation">')
    expect(head.indexOf("og:image")).toBeLessThan(head.indexOf('name="robots"'))
    expect(head.indexOf("twitter:image")).toBeLessThan(head.indexOf("<script>"))
    expect(tags(html)).toMatchObject({
      "og:type": "website",
      "og:site_name": "Nodaro",
      "og:locale": "en_US",
      "og:title": "Red car · Image Generation",
      "og:description": "A picture made with Nodaro",
      "og:url": "https://share.example/s/TOKEN",
      "og:image": RENDERED.url,
      "og:image:secure_url": RENDERED.url,
      "og:image:type": "image/jpeg",
      "og:image:width": "1200",
      "og:image:height": "630",
      "og:image:alt": "Red car · Image Generation",
      "twitter:card": "summary_large_image",
      "twitter:title": "Red car · Image Generation",
      "twitter:description": "A picture made with Nodaro",
      "twitter:image": RENDERED.url,
      "twitter:image:alt": "Red car · Image Generation",
      description: "A picture made with Nodaro",
    })
    expect(html).toContain('<link rel="canonical" href="https://share.example/s/TOKEN">')
    expect(html).toContain('<meta name="robots" content="noindex">')
  })

  it("before its own picture is rendered: the result's picture already ours, with what is known of it; else the brand's card", () => {
    const own = tags(shareCardHtml(jobCardContent(job(), {}, SOURCES), PLACE).html)
    expect(own).toMatchObject({ "og:image": "https://cdn.example/images/a1.png", "og:image:width": "1920", "og:image:height": "1080", "og:image:type": "image/png" })
    const brand = tags(shareCardHtml(jobCardContent(song({ coverUrl: "https://musicfile.provider.example/c.jpeg" }), {}, SOURCES), PLACE).html)
    expect(brand).toMatchObject({ "og:image": PLACE.defaultImage.url, "og:image:width": "1200", "og:image:height": "630", "og:image:type": "image/jpeg" })
    expect(JSON.stringify(brand)).not.toContain("provider.example")
  })

  it("a video card names our video; another host's video is never named", () => {
    const content = jobCardContent(job({ mediaKind: "video", type: "image-to-video", outputUrl: "https://cdn.example/videos/v.webm" }), {}, SOURCES)
    expect(tags(shareCardHtml(content, PLACE).html)).toMatchObject({
      "og:type": "video.other",
      "og:video": "https://cdn.example/videos/v.webm",
      "og:video:secure_url": "https://cdn.example/videos/v.webm",
      "og:video:type": "video/webm",
      "og:video:width": "1920",
      "og:video:height": "1080",
    })
    const foreign = jobCardContent(job({ mediaKind: "video", outputUrl: "https://files.provider.example/v.mp4" }), {}, SOURCES)
    expect(shareCardHtml(foreign, PLACE).html).not.toContain("og:video")
  })

  it("a sound card names our sound as og:audio", () => {
    const t = tags(shareCardHtml(jobCardContent(song(), {}, SOURCES), PLACE).html)
    expect(t).toMatchObject({ "og:audio": "https://cdn.example/audios/s.mp3", "og:audio:secure_url": "https://cdn.example/audios/s.mp3", "og:audio:type": "audio/mpeg" })
    expect(t["og:type"]).toBe("website")
  })

  it("a Hebrew link: lang, direction and og:locale", () => {
    const { html } = shareCardHtml(jobCardContent(song(), {}, SOURCES, "he"), PLACE)
    expect(html).toContain('<html lang="he" dir="rtl">')
    expect(tags(html)["og:locale"]).toBe("he_IL")
  })

  it("sends people to the share page three ways: refresh, script and a plain link", () => {
    const { html, csp } = shareCardHtml(jobCardContent(job(), {}, SOURCES), PLACE)
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=https://share.example/shared/TOKEN">')
    expect(html).toContain('<script>location.replace("https://share.example/shared/TOKEN")</script>')
    expect(html).toContain('<a href="https://share.example/shared/TOKEN">')
    expect(html).not.toMatch(/url=https:\/\/share\.example\/s\//)
    expect(csp).toMatch(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'/)
  })

  it('escapes every value: a name with "<script> stays inert', () => {
    const evil = `"><script>alert(1)</script><meta property="og:image" content="https://evil.example/x.png`
    const { html } = shareCardHtml(jobCardContent(job({ prompt: evil, displayPrompt: evil, title: `'<b>"&` }), {}, SOURCES), PLACE)
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&#39;&lt;b&gt;&quot;&amp;")
    expect(html.match(/<script>/g)).toHaveLength(1)
    expect(tags(html)["og:image"]).toBe("https://cdn.example/images/a1.png")
    const { html: html2 } = shareCardHtml(jobCardContent(job({ prompt: evil, displayPrompt: evil }), {}, SOURCES), PLACE)
    expect(html2).not.toContain('content="https://evil.example/x.png"')
    expect(html2).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;")
  })

  it("the script cannot be closed by its address", () => {
    const { html } = shareCardHtml(jobCardContent(job(), {}, SOURCES), { ...PLACE, pageUrl: "https://share.example/shared/</script><script>alert(1)//" })
    expect(html).not.toContain("</script><script>alert(1)")
    expect(html).toContain("\\u003c/script>")
  })
})

describe("the 404 card", () => {
  it("says nothing about any content and is not indexed", () => {
    const { html, csp } = shareCardNotFoundHtml()
    expect(html).not.toMatch(/og:|twitter:/)
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).not.toContain("<script")
    expect(csp).toContain("default-src 'none'")
  })
})

describe("helpers", () => {
  it("shareSiteOriginOf reads an http(s) origin, else the default", () => {
    expect(shareSiteOriginOf("https://next.nodaro.ai")).toBe("https://next.nodaro.ai")
    expect(shareSiteOriginOf("https://next.nodaro.ai/")).toBe("https://next.nodaro.ai")
    expect(shareSiteOriginOf(" http://localhost:5173 ")).toBe("http://localhost:5173")
    for (const bad of [undefined, "", "nodaro.ai", "https://nodaro.ai/path", "https://nodaro.ai/?x=1", "javascript:alert(1)", "https://u:p@nodaro.ai"]) {
      expect(shareSiteOriginOf(bad), String(bad)).toBe("https://nodaro.ai")
    }
  })

  it("escapeHtml, clip and mediaTypeOf", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;")
    expect(clip("  a   b  ", 10)).toBe("a b")
    expect(clip("abcdefghij", 5)).toBe("abcd…")
    expect(mediaTypeOf("https://x/a.mp3?v=1")).toBe("audio/mpeg")
    expect(mediaTypeOf("https://x/a.JPG")).toBe("image/jpeg")
    expect(mediaTypeOf("https://x/a")).toBeUndefined()
  })
})
