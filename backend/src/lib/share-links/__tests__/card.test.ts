/**
 * The share card's content and HTML (lib/share-links/card.ts): the tags say
 * what the link shows and nothing more, every value is escaped, only https
 * addresses are written, people are sent on to the share page, and the share
 * site's origin is read safely.
 */
import { describe, it, expect } from "vitest"
import {
  clip,
  escapeHtml,
  jobCardContent,
  projectCardContent,
  sessionCardContent,
  shareCardHtml,
  shareCardNotFoundHtml,
  shareSiteOriginOf,
} from "../card.js"
import type { SharedJob } from "../types.js"

const PLACE = {
  cardUrl: "https://share.example/s/TOKEN",
  pageUrl: "https://share.example/shared/TOKEN",
  defaultImage: { url: "https://app.example/logo-512.png", width: 512, height: 512 },
}

function job(over: Partial<SharedJob> = {}): SharedJob {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    type: "generate-image",
    mediaKind: "image",
    outputUrl: "https://cdn.example/images/a1.png",
    width: 1920,
    height: 1080,
    title: null,
    createdAt: "2026-11-19T10:00:00Z",
    prompt: "a red car on a beach at sunset",
    displayPrompt: "a red car on a beach at sunset",
    model: { id: "nano-banana-pro", name: "Nano Banana Pro" },
    settings: {},
    ...over,
  }
}

/** The content of every `<meta property|name=… content=…>`, by key. */
function tags(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)">/g)) out[m[1]!] = m[2]!
  return out
}

describe("jobCardContent", () => {
  it("an image: its name (else the prompt's start), the prompt, the image and its size", () => {
    expect(jobCardContent(job(), {})).toEqual({
      title: "a red car on a beach at sunset",
      description: "a red car on a beach at sunset",
      image: { url: "https://cdn.example/images/a1.png", width: 1920, height: 1080 },
    })
    expect(jobCardContent(job({ title: "Red car" }), {}).title).toBe("Red car")
  })

  it("a video: its poster, and the video with its type and size", () => {
    const content = jobCardContent(job({ mediaKind: "video", outputUrl: "https://cdn.example/videos/v.webm" }), { thumbnailUrl: "https://cdn.example/images/v-thumb.jpg" })
    expect(content.image).toEqual({ url: "https://cdn.example/images/v-thumb.jpg" })
    expect(content.video).toEqual({ url: "https://cdn.example/videos/v.webm", type: "video/webm", width: 1920, height: 1080 })
    expect(jobCardContent(job({ mediaKind: "video", outputUrl: "https://cdn.example/videos/v.mp4" }), {}).video?.type).toBe("video/mp4")
  })

  it("a sound: its cover when it has one (a Suno track's), else none (the default picture)", () => {
    const sound = job({ mediaKind: "audio", outputUrl: "https://cdn.example/audios/s.mp3", width: undefined, height: undefined })
    expect(jobCardContent(sound, { sunoImageUrl: "https://covers.example/c.jpeg" }).image).toEqual({ url: "https://covers.example/c.jpeg" })
    expect(jobCardContent(sound, {}).image).toBeNull()
    // Never an address that is not https, or one the caller refuses.
    expect(jobCardContent(sound, { imageUrl: "http://covers.example/c.jpeg" }).image).toBeNull()
    expect(jobCardContent(sound, { imageUrl: "https://covers.example/c.jpeg" }, () => true).image).toBeNull()
  })

  it("reads the prompt as a person does: the pills' names, never the raw tokens", () => {
    const content = jobCardContent(job({ prompt: "@image-1:1 Viral entrepreneurial transformation", displayPrompt: "@Image 1 Viral entrepreneurial transformation" }), {})
    expect(content.title).toBe("@Image 1 Viral entrepreneurial transformation")
    expect(content.description).toBe("@Image 1 Viral entrepreneurial transformation")
    // The result's own name comes first.
    expect(jobCardContent(job({ title: "Launch day", displayPrompt: "@Maya at the launch" }), {}).title).toBe("Launch day")
    // An older projection without it falls back to the prompt.
    expect(jobCardContent(job({ displayPrompt: undefined as unknown as null }), {}).description).toBe("a red car on a beach at sunset")
  })

  it("a trend run: the trend's name, never a prompt", () => {
    const content = jobCardContent(job({ prompt: null, displayPrompt: null, trend: { slug: "office-dance", name: "Office Dance" } }), {})
    expect(content.title).toBe("Office Dance")
    expect(content.description).toBe("Made with the Office Dance trend on Nodaro.")
  })

  it("a long prompt is cut: about 70 characters for the title, 200 for the description", () => {
    const content = jobCardContent(job({ prompt: "word ".repeat(100), displayPrompt: "word ".repeat(100) }), {})
    expect(Array.from(content.title).length).toBeLessThanOrEqual(70)
    expect(Array.from(content.description!).length).toBeLessThanOrEqual(200)
    expect(content.description!.endsWith("…")).toBe(true)
  })
})

describe("session and project cards", () => {
  it("their own title or name, and their first result's picture", () => {
    expect(sessionCardContent("Beach", 3, "https://cdn.example/images/c.png")).toEqual({
      title: "Beach",
      description: "3 results on Nodaro.",
      image: { url: "https://cdn.example/images/c.png" },
    })
    expect(sessionCardContent(null, 1, null)).toMatchObject({ title: "A session shared on Nodaro", description: "1 result on Nodaro.", image: null })
    expect(projectCardContent("Holiday", 2, "https://cdn.example/images/c.png")).toMatchObject({ title: "Holiday", description: "2 sessions on Nodaro." })
  })
})

describe("shareCardHtml", () => {
  it("writes the Open Graph and Twitter tags, the share address as og:url and canonical", () => {
    const { html } = shareCardHtml(jobCardContent(job({ title: "Red car" }), {}), PLACE)
    expect(tags(html)).toMatchObject({
      "og:type": "website",
      "og:site_name": "Nodaro",
      "og:title": "Red car",
      "og:description": "a red car on a beach at sunset",
      "og:url": "https://share.example/s/TOKEN",
      "og:image": "https://cdn.example/images/a1.png",
      "og:image:width": "1920",
      "og:image:height": "1080",
      "twitter:card": "summary_large_image",
      "twitter:title": "Red car",
      "twitter:description": "a red car on a beach at sunset",
      "twitter:image": "https://cdn.example/images/a1.png",
    })
    expect(html).toContain('<link rel="canonical" href="https://share.example/s/TOKEN">')
    expect(html).toContain('<meta name="robots" content="noindex">')
  })

  it("sends people to the share page three ways: refresh, script and a plain link", () => {
    const { html, csp } = shareCardHtml(jobCardContent(job(), {}), PLACE)
    expect(html).toContain('<meta http-equiv="refresh" content="0; url=https://share.example/shared/TOKEN">')
    expect(html).toContain('<script>location.replace("https://share.example/shared/TOKEN")</script>')
    expect(html).toContain('<a href="https://share.example/shared/TOKEN">')
    // Never back to the card's own address, which would loop.
    expect(html).not.toMatch(/url=https:\/\/share\.example\/s\//)
    // The page runs its one script and nothing else.
    expect(csp).toMatch(/^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'/)
  })

  it("a video card names the video", () => {
    const { html } = shareCardHtml(
      jobCardContent(job({ mediaKind: "video", outputUrl: "https://cdn.example/videos/v.mp4" }), { thumbnailUrl: "https://cdn.example/images/t.jpg" }),
      PLACE,
    )
    expect(tags(html)).toMatchObject({
      "og:type": "video.other",
      "og:image": "https://cdn.example/images/t.jpg",
      "og:video": "https://cdn.example/videos/v.mp4",
      "og:video:secure_url": "https://cdn.example/videos/v.mp4",
      "og:video:type": "video/mp4",
      "og:video:width": "1920",
      "og:video:height": "1080",
    })
  })

  it("a card with no picture of its own takes the default one, with its size", () => {
    const { html } = shareCardHtml(sessionCardContent("Beach", 0, null), PLACE)
    expect(tags(html)).toMatchObject({ "og:image": "https://app.example/logo-512.png", "og:image:width": "512", "twitter:image": "https://app.example/logo-512.png" })
  })

  it('escapes every value: a prompt with "<script> stays inert', () => {
    const evil = `"><script>alert(1)</script><meta property="og:image" content="https://evil.example/x.png`
    const { html } = shareCardHtml(jobCardContent(job({ prompt: evil, displayPrompt: evil, title: `'<b>"&` }), {}), PLACE)
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).not.toContain('content="https://evil.example/x.png"')
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("&#39;&lt;b&gt;&quot;&amp;")
    // One script on the page: the redirect.
    expect(html.match(/<script>/g)).toHaveLength(1)
    expect(tags(html)["og:image"]).toBe("https://cdn.example/images/a1.png")
  })

  it("the script cannot be closed by its address", () => {
    const { html } = shareCardHtml(jobCardContent(job(), {}), { ...PLACE, pageUrl: "https://share.example/shared/</script><script>alert(1)//" })
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

  it("escapeHtml and clip", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;")
    expect(clip("  a   b  ", 10)).toBe("a b")
    expect(clip("abcdefghij", 5)).toBe("abcd…")
  })
})
