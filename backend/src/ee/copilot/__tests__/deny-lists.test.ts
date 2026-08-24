/**
 * The exfiltration boundary, DERIVED from the orchestrator's executor rather
 * than asserted against a hand-kept list — the first version of this test
 * checked only the social block and a six-field list, and missed both the
 * web-scrape actors and every nested URL. A new outbound node type or a new
 * destination field must fail this test, not ship.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DENIED_NODE_TYPES, changedLockedUrlFields, isDeniedNodeType, isLockedField } from "../tools/deny-lists.js"

const ENGINE_DIR = join(__dirname, "..", "..", "..", "services", "workflow-engine")
const NODE_EXECUTOR = readFileSync(join(ENGINE_DIR, "node-executor.ts"), "utf8")
const INLINE_EXECUTOR = readFileSync(join(ENGINE_DIR, "inline-executor.ts"), "utf8")

/** `case "x": case "y": { … }` — the case labels that share one executor block. */
function caseBlocks(source: string): Array<{ types: string[]; body: string }> {
  const blocks: Array<{ types: string[]; body: string }> = []
  const re = /((?:\s*case "[a-z0-9-]+":)+)\s*\{?([\s\S]*?)(?=\n\s{4}case "|\n\s{4}default:)/g
  for (const match of source.matchAll(re)) {
    const types = [...match[1]!.matchAll(/case "([a-z0-9-]+)":/g)].map((m) => m[1]!)
    blocks.push({ types, body: match[2] ?? "" })
  }
  return blocks
}

/** A destination the executor takes from node data: `data.url`, `data.target`, `data.chatId`, … */
const DESTINATION_READ = /\bdata\.(\w*(?:[Uu]rls?|target|query|channel|chatId|connectionId|platform|endpoint|host))\b/

describe("denied node types (derived from the executors)", () => {
  it("every node whose executor reads a destination from node data is denied", () => {
    const offenders: string[] = []
    for (const block of [...caseBlocks(NODE_EXECUTOR), ...caseBlocks(INLINE_EXECUTOR)]) {
      if (!DESTINATION_READ.test(block.body)) continue
      for (const type of block.types) {
        // Media nodes legitimately carry *Url fields the ENGINE fills from
        // upstream edges; what matters here is a destination the node itself
        // names for an outbound request. Those blocks all reach a fetch/post.
        const outbound = /apify|fetch|safeFetch|social|publish|webhook|scrape|rss|telegram|youtube/i.test(block.body)
        if (!outbound) continue
        if (!DENIED_NODE_TYPES.has(type)) offenders.push(type)
      }
    }
    expect(
      [...new Set(offenders)],
      "add these to DENIED_NODE_TYPES — their executor sends to, or fetches from, a destination the node data names",
    ).toEqual([])
  })

  it("covers the known outbound set explicitly", () => {
    for (const type of [
      "webhook-output",
      "x-post",
      "telegram-post",
      "linkedin-post",
      "facebook-post",
      "instagram-post",
      "tiktok-post",
      "youtube-upload",
      "publish-social",
      "web-scrape",
      "rss-feed",
      "telegram-channel-feed",
      "youtube-video",
    ]) {
      expect(isDeniedNodeType(type), `${type} must be denied`).toBe(true)
    }
  })

  it("does not deny ordinary generation nodes", () => {
    for (const type of ["generate-image", "image-to-video", "text-prompt", "combine-videos", "list"]) {
      expect(isDeniedNodeType(type)).toBe(false)
    }
  })
})

describe("locked fields", () => {
  it("locks every *Url / *Urls key the engine reads, by pattern", () => {
    // Sampled from the engine's own reads — the old fixed list covered 10 of
    // these and let the rest through.
    for (const field of [
      "url",
      "webhookUrl",
      "imageUrl",
      "imageUrls",
      "videoUrls",
      "referenceImageUrls",
      "sourceImageUrl",
      "startFrameUrl",
      "maskUrl",
      "youtubeUrl",
      "instrumentalUrl",
      "target",
      "query",
      "channel",
      "chatId",
      "connectionId",
    ]) {
      expect(isLockedField(field), `${field} must be locked`).toBe(true)
    }
  })

  it("leaves ordinary configuration alone", () => {
    for (const field of ["prompt", "label", "provider", "duration", "aspectRatio"]) {
      expect(isLockedField(field)).toBe(false)
    }
  })

  it("flags a destination the model introduces or changes", () => {
    expect(changedLockedUrlFields(undefined, { url: "https://evil.test/collect" })).toEqual(["url"])
    expect(changedLockedUrlFields({ chatId: "@mine" }, { chatId: "@attacker" })).toEqual(["chatId"])
    expect(changedLockedUrlFields({}, { imageUrls: ["https://evil.test/a.png"] })).toEqual(["imageUrls"])
  })

  it("finds a destination NESTED inside a config object", () => {
    expect(changedLockedUrlFields({}, { probedVideo: { url: "https://evil.test/x.mp4" } })).toEqual(["probedVideo.url"])
  })

  it("allows preserving the user's own value and ignores empty writes", () => {
    expect(changedLockedUrlFields({ url: "https://mine.test" }, { url: "https://mine.test" })).toEqual([])
    expect(changedLockedUrlFields({ url: "https://mine.test" }, { url: "" })).toEqual([])
    expect(changedLockedUrlFields({ imageUrls: [] }, { imageUrls: [] })).toEqual([])
    expect(changedLockedUrlFields(undefined, { prompt: "a cat", nested: { prompt: "also fine" } })).toEqual([])
  })

  describe("a destination hidden in a LIST", () => {
    // `extraRefs` is the live case: seven node types carry it, the config
    // panels are its only legitimate writer, and the run engine feeds its
    // urls straight to providers. Until the walk descended into arrays, the
    // model could author one — the key itself is not locked, so the whole
    // list was waved through.
    const ref = (url: string) => ({ url, description: "a ref" })

    it("flags a url the model appends to a list", () => {
      expect(changedLockedUrlFields({}, { extraRefs: [ref("https://evil.test/x.png")] })).toEqual([
        "extraRefs[0].url",
      ])
    })

    it("flags the NEW one when it rides along with the user's own", () => {
      const mine = ref("https://mine.test/a.png")
      expect(
        changedLockedUrlFields({ extraRefs: [mine] }, { extraRefs: [mine, ref("https://evil.test/b.png")] }),
      ).toEqual(["extraRefs[1].url"])
    })

    it("lets the user's own list be reordered or trimmed", () => {
      // By VALUE, not by index: after a removal every later element shifts,
      // and comparing position to position would call all of them changed.
      const a = ref("https://mine.test/a.png")
      const b = ref("https://mine.test/b.png")
      expect(changedLockedUrlFields({ extraRefs: [a, b] }, { extraRefs: [b, a] })).toEqual([])
      expect(changedLockedUrlFields({ extraRefs: [a, b] }, { extraRefs: [b] })).toEqual([])
      expect(changedLockedUrlFields({ extraRefs: [a, b] }, { extraRefs: [a, b] })).toEqual([])
    })

    it("still finds one buried deeper in the list", () => {
      expect(
        changedLockedUrlFields({}, { blocks: [{ media: { videoUrl: "https://evil.test/v.mp4" } }] }),
      ).toEqual(["blocks[0].media.videoUrl"])
    })

    it("leaves a list with no destinations in it alone", () => {
      expect(changedLockedUrlFields({}, { items: ["a", "b"], rows: [{ prompt: "a cat" }] })).toEqual([])
    })

    it("does not change how a LOCKED key holding a list behaves", () => {
      // `imageUrls` was and stays whole-array: preserved or rejected as one.
      expect(changedLockedUrlFields({}, { imageUrls: ["https://evil.test/a.png"] })).toEqual(["imageUrls"])
      const own = ["https://mine.test/a.png"]
      expect(changedLockedUrlFields({ imageUrls: own }, { imageUrls: own })).toEqual([])
    })
  })
})
