/**
 * Every scraper's JSON wires like every other scraper's.
 *
 * Instagram was added to none of the sets that carry scraped JSON, so its
 * `json` output could not be wired to Extract Field or List (the docs rebuild
 * found it; Meta Ads and Web Scrape were in all of them). The sets now spread
 * ONE list, `SCRAPE_NODE_TYPES`; these cases hold every scraper to the same
 * wiring, and fail when a new `*-scrape` node is not in that list.
 */
import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS, type SceneNodeType } from "@/types/nodes"
import { SCRAPE_NODE_TYPES } from "../scrape-node-types"
import { isValidWorkflowConnection } from "../connection-validation"
import { JSON_PRODUCER_TYPES as PROMPT_JSON_PRODUCER_TYPES } from "../generate-image-handles"
import { JSON_PRODUCER_TYPES, LIST_PRODUCER_TYPES } from "../data-handles"
import { TARGET_HANDLE_ACCEPTS } from "../target-handle-registry"
import { getCompatibleNodes, type NodeOption } from "../node-compatibility"

const typeOf = (id: string) => id

describe("SCRAPE_NODE_TYPES", () => {
  it("lists every scraper node the editor defines, and nothing else", () => {
    // Social Search is a scraper by shape (queries in on `in`, posts out on
    // `json`) under a name that does not end in "-scrape".
    const defined = NODE_DEFINITIONS.map((d) => d.type as string).filter((t) => t.endsWith("-scrape") || t === "web-scrape" || t === "social-search")
    expect(new Set(defined)).toEqual(new Set(SCRAPE_NODE_TYPES))
  })

  it("every scraper is in every set that carries scraped JSON", () => {
    for (const type of SCRAPE_NODE_TYPES) {
      expect(PROMPT_JSON_PRODUCER_TYPES.has(type), `${type}: prompt JSON producers`).toBe(true)
      expect(JSON_PRODUCER_TYPES.has(type), `${type}: JSON producers`).toBe(true)
      expect(LIST_PRODUCER_TYPES.has(type), `${type}: list producers`).toBe(true)
      expect(TARGET_HANDLE_ACCEPTS[type]?.some((e) => e.handleId === "in"), `${type}: its input is registered`).toBe(true)
    }
  })
})

describe.each(SCRAPE_NODE_TYPES)("%s json output", (scraper) => {
  it("wires into Extract Field and List", () => {
    expect(isValidWorkflowConnection({ source: scraper, target: "extract-field", sourceHandle: "json", targetHandle: "in" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: scraper, target: "list", sourceHandle: "json", targetHandle: "in" }, typeOf)).toBe(true)
  })

  it("its own input refuses an image", () => {
    expect(isValidWorkflowConnection({ source: "upload-image", target: scraper, sourceHandle: "image", targetHandle: "in" }, typeOf)).toBe(false)
  })
})

describe("add-node suggestions from a scraper pip", () => {
  const opt = (type: string): NodeOption => ({ type: type as SceneNodeType, label: type, icon: null, category: "x" })
  const pool = [opt("extract-field"), opt("generate-image"), opt("upscale-image")]

  it("the json pip suggests data consumers", () => {
    const out = getCompatibleNodes("json", "source", pool, "instagram-scrape")
    expect(out.direct.map((o) => o.type)).toContain("extract-field")
  })

  it("the image pip is offered what an image is offered, not only data nodes", () => {
    // Before, every scraper pip took the data-node branch, so an image pip was
    // offered Extract Field and never an image consumer.
    const suggest = (type: string) => {
      const out = getCompatibleNodes("image", "source", pool, type)
      return { direct: out.direct.map((o) => o.type), compatible: out.compatible.map((o) => o.type) }
    }
    for (const scraper of ["meta-ads-scrape", "instagram-scrape"]) {
      expect(suggest(scraper), scraper).toEqual(suggest("upload-image"))
      expect([...suggest(scraper).direct, ...suggest(scraper).compatible], scraper).toContain("upscale-image")
    }
  })
})
