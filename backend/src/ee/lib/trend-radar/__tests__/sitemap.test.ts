import { describe, expect, it } from "vitest"
import { nameOfSlug, newTemplatePages, parseSitemap, slugOfName, templateSlugOf } from "../sitemap.js"

const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.test/</loc><lastmod>2026-11-01T12:00:00.000Z</lastmod></url>
  <url><loc>https://example.test/templates/phone-on-train-ai-trend</loc><lastmod>2026-11-01T00:00:00.000Z</lastmod><changefreq>weekly</changefreq></url>
  <url>
    <loc>https://example.test/templates/ramalama-costume-walk</loc>
    <lastmod>2026-10-28</lastmod>
  </url>
  <url><loc>https://example.test/blog/how-we-work</loc><lastmod>2026-10-30</lastmod></url>
  <url><loc>https://example.test/templates/ai-trend</loc></url>
  <url><loc>https://example.test/templates/rock&amp;roll</loc><lastmod>not a date</lastmod></url>
</urlset>`

const INDEX = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.test/sitemap-templates.xml</loc></sitemap>
  <sitemap><loc>https://example.test/sitemap-blog.xml</loc></sitemap>
</sitemapindex>`

describe("parseSitemap", () => {
  it("reads every page with its lastmod, decoding entities and dropping an unreadable date", () => {
    const parsed = parseSitemap(URLSET)
    expect(parsed.sitemaps).toEqual([])
    expect(parsed.urls).toEqual([
      { url: "https://example.test/", lastmod: "2026-11-01T12:00:00.000Z" },
      { url: "https://example.test/templates/phone-on-train-ai-trend", lastmod: "2026-11-01T00:00:00.000Z" },
      { url: "https://example.test/templates/ramalama-costume-walk", lastmod: "2026-10-28" },
      { url: "https://example.test/blog/how-we-work", lastmod: "2026-10-30" },
      { url: "https://example.test/templates/ai-trend", lastmod: null },
      { url: "https://example.test/templates/rock&roll", lastmod: null },
    ])
  })

  it("reads a sitemap index as the child sitemaps to follow", () => {
    const parsed = parseSitemap(INDEX)
    expect(parsed.urls).toEqual([])
    expect(parsed.sitemaps).toEqual(["https://example.test/sitemap-templates.xml", "https://example.test/sitemap-blog.xml"])
  })

  it("is empty on anything else", () => {
    expect(parseSitemap("<html><body>nope</body></html>")).toEqual({ urls: [], sitemaps: [] })
    expect(parseSitemap("")).toEqual({ urls: [], sitemaps: [] })
  })
})

describe("templateSlugOf", () => {
  it("takes the slug of a page under a template section only", () => {
    expect(templateSlugOf("https://a.test/templates/phone-on-train-ai-trend")).toBe("phone-on-train-ai-trend")
    expect(templateSlugOf("https://a.test/trends/bulin-47-ai-trend/")).toBe("bulin-47-ai-trend")
    expect(templateSlugOf("https://a.test/explore/dog-bartender")).toBe("dog-bartender")
    expect(templateSlugOf("https://a.test/blog/phone-on-train")).toBeNull()
    expect(templateSlugOf("https://a.test/templates")).toBeNull()
    expect(templateSlugOf("https://a.test/")).toBeNull()
    expect(templateSlugOf("https://a.test/templates/rock&roll")).toBeNull()
    expect(templateSlugOf("not a url")).toBeNull()
  })
})

describe("nameOfSlug", () => {
  it("drops the noise words at the ends and keeps the name", () => {
    expect(nameOfSlug("phone-on-train-ai-trend")).toBe("phone on train")
    expect(nameOfSlug("ai-dog-bartender")).toBe("dog bartender")
    expect(nameOfSlug("bulin-47-ai-trend")).toBe("bulin 47")
    expect(nameOfSlug("tiny-desk")).toBe("tiny desk")
    expect(nameOfSlug("ai-video-template")).toBeNull()
  })
})

describe("slugOfName", () => {
  it("makes a stable slug of a name", () => {
    expect(slugOfName("Phone on the Train")).toBe("phone-on-the-train")
    expect(slugOfName("  Bulin 47 ")).toBe("bulin-47")
    expect(slugOfName("Café Ólé!")).toBe("cafe-ole")
  })
})

describe("newTemplatePages", () => {
  it("lists the template pages not seen before, newest first, once each", () => {
    const parsed = parseSitemap(URLSET)
    const pages = newTemplatePages(parsed.urls, new Set(["ramalama-costume-walk"]))
    expect(pages).toEqual([
      { slug: "phone-on-train-ai-trend", name: "phone on train", url: "https://example.test/templates/phone-on-train-ai-trend", lastmod: "2026-11-01T00:00:00.000Z" },
    ])
  })
})
