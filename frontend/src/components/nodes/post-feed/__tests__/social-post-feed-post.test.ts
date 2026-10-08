import { describe, it, expect } from "vitest"
import { translate, type TFunction } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"
import { socialPostFeedPost, type ReaderPost } from "../social-post-feed-post"

const t: TFunction = (key, vars) => translate("en", key, vars)

function post(over: Partial<ReaderPost> = {}): ReaderPost {
  return {
    id: "instagram:1",
    platform: "instagram",
    url: "https://www.instagram.com/p/abc/",
    text: "Our new voices are live",
    author: { handle: "acme.studio", name: "Acme Studio" },
    publishedAt: "2026-10-05T10:00:00Z",
    metrics: { views: 5400 },
    media: { kind: "image", thumbnailUrl: "https://media.nodaro.ai/stills/1.jpg" },
    hashtags: [],
    extra: {},
    ...over,
  } as ReaderPost
}

describe("socialPostFeedPost", () => {
  it("a post with no title leads with its handle, left to right; Open in its platform", () => {
    const fp = socialPostFeedPost(post(), t)
    expect(fp.heading).toBe("@acme.studio")
    expect(fp.headingDir).toBe("ltr")
    expect(fp.text).toBe("Our new voices are live")
    expect(fp.stat).toBe(`${formatNumber(5400)} views`)
    expect(fp.site).toBe("Instagram")
    expect(fp.openUrl).toBe("https://www.instagram.com/p/abc/")
    expect(fp.previewUrl).toBe("https://media.nodaro.ai/stills/1.jpg")
    expect(fp.meta[0]).not.toBe("")
  })

  it("a titled post leads with the title and puts who posted it in the date line", () => {
    const fp = socialPostFeedPost(post({ title: "Launch day", text: "Launch day" }), t)
    expect(fp.heading).toBe("Launch day")
    expect(fp.headingDir).toBe("auto")
    expect(fp.text).toBe("")
    expect(fp.meta[1]).toBe("@acme.studio")
  })

  it("a saved post says when it was saved", () => {
    expect(socialPostFeedPost(post({ savedAt: "2026-10-06T09:00:00Z" }), t).meta[2]).toMatch(/^Saved /)
    expect(socialPostFeedPost(post(), t).meta[2]).toBe("")
  })

  it("the platform names the link: X, not the host", () => {
    expect(socialPostFeedPost(post({ platform: "x", url: "https://twitter.com/a/status/1" }), t).site).toBe("X")
  })

  it("a video plays its file when there is one, else on the post's page", () => {
    expect(socialPostFeedPost(post({ media: { kind: "video", videoUrl: "https://cdn.example/v.mp4" } }), t).video).toEqual({ url: "https://cdn.example/v.mp4" })
    expect(socialPostFeedPost(post({ media: { kind: "video" } }), t).video).toEqual({ url: null })
    expect(socialPostFeedPost(post(), t).video).toBeNull()
  })

  it("a link that is not http(s) is never opened", () => {
    expect(socialPostFeedPost(post({ url: "javascript:alert(1)" }), t).openUrl).toBeNull()
  })

  it("one view reads in the singular", () => {
    expect(socialPostFeedPost(post({ metrics: { views: 1 } }), t).stat).toBe("1 view")
  })
})
