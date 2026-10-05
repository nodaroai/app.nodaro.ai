import { createElement, Fragment } from "react"
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { CompetitorDetail, CompetitorPlatformTally, CompetitorPost } from "@nodaro/shared"
import { en } from "@/lib/i18n/en"
import { brandTallies } from "../brand-platforms"
import { sayText } from "../say-text"
import { usualText } from "../usual-text"

const t = (key: keyof typeof en, vars: Record<string, string | number> = {}) =>
  Object.entries(vars).reduce<string>((s, [k, v]) => s.replace(`{${k}}`, String(v)), en[key])

const tally = (platform: string, own = 1): CompetitorPlatformTally =>
  ({ platform, own, about: 0, searched: ["own"], failed: [], usual: null, unit: null, top: null }) as CompetitorPlatformTally

function post(id: string, platform: CompetitorPost["platform"], role: CompetitorPost["role"]): CompetitorPost {
  return { id, platform, url: "", text: "", author: { handle: "h", name: "" }, metrics: {}, media: { kind: "text" }, hashtags: [], extra: {}, role }
}

describe("brandTallies", () => {
  it("keeps the page's platform order and drops a platform the page cannot show", () => {
    const detail = { latestScan: null, platforms: [tally("reddit"), tally("a-new-network"), tally("x"), tally("tiktok")] } as Pick<CompetitorDetail, "platforms" | "latestScan">
    expect(brandTallies(detail).map((p) => p.platform)).toEqual(["x", "tiktok", "reddit"])
  })

  it("counts a scan's posts per platform when the server sends no tallies", () => {
    const detail = {
      platforms: undefined,
      latestScan: { id: "s", at: "2026-10-01T10:00:00Z", counts: { own: 2, about: 1 }, posts: [post("1", "tiktok", "own"), post("2", "tiktok", "about"), post("3", "x", "own")], cards: [] },
    } as unknown as Pick<CompetitorDetail, "platforms" | "latestScan">
    expect(brandTallies(detail)).toMatchObject([
      { platform: "x", own: 1, about: 0, failed: null },
      { platform: "tiktok", own: 1, about: 1, failed: null },
    ])
  })
})

describe("usualText", () => {
  it("says one in the singular, and the rest compact", () => {
    expect(usualText({ usual: 1, unit: "likes" }, t)).toBe("1 like")
    expect(usualText({ usual: 201000, unit: "views" }, t)?.replace(/[‎‏]/g, "")).toBe("201K views")
    expect(usualText({ usual: null, unit: "views" }, t)).toBeNull()
  })
})

describe("sayText", () => {
  it("isolates the quote, so its marks keep their side in a right-to-left sentence", () => {
    const { container } = render(createElement(Fragment, null, sayText({ kind: "complaints", quote: "It peeled!" }, false, t)))
    expect(container.querySelector("bdi")?.textContent).toBe("It peeled!")
    expect(container.textContent).toBe("People complain: “It peeled!”")
  })

  it("speaks of the person's own brand as theirs", () => {
    const { container } = render(createElement(Fragment, null, sayText({ kind: "spreading", quote: "Wow" }, true, t)))
    expect(container.textContent).toBe("A post about you is spreading: “Wow”")
  })
})
