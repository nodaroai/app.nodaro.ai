import vm from "node:vm"
import { describe, it, expect } from "vitest"
import {
  JOB_AUTO_CLASSIFY_JS,
  JOB_AUTO_TEXT_OUTPUT_KEYS,
  buildJobAutoWidget,
} from "../job-auto.js"
import { WIDGET_MEDIA_ORIGINS } from "../csp-origins.js"

type Item = { kind: string; value: string; title?: string }

function classify(sc: Record<string, unknown>): Item[] {
  const ctx: Record<string, unknown> = { sc, origins: WIDGET_MEDIA_ORIGINS, out: null }
  vm.runInNewContext(`${JOB_AUTO_CLASSIFY_JS}; out = classifyJobOutput(sc, origins);`, ctx)
  return ctx.out as Item[]
}

const R2 = "https://cdn.nodaro.ai"

describe("classifyJobOutput decision matrix", () => {
  // Rule 1 — normalized outputUrl + assetKind
  it("renders video for assetKind=video", () => {
    const items = classify({ outputUrl: `${R2}/videos/j1.mp4`, assetKind: "video", outputData: {} })
    expect(items).toEqual([{ kind: "video", value: `${R2}/videos/j1.mp4` }])
  })
  it("renders image for assetKind=image", () => {
    expect(classify({ outputUrl: `${R2}/images/j1.png`, assetKind: "image", outputData: {} })[0]!.kind).toBe("image")
  })
  it("renders audio for assetKind=audio", () => {
    expect(classify({ outputUrl: `${R2}/audios/j1.wav`, assetKind: "audio", outputData: {} })[0]!.kind).toBe("audio")
  })
  it("sniffs extension from PATHNAME when assetKind is null (query string ignored)", () => {
    const items = classify({ outputUrl: `${R2}/videos/j1.mp4?sig=a.png`, assetKind: null, outputData: {} })
    expect(items[0]!.kind).toBe("video")
  })
  it("unknown extension with null assetKind → link", () => {
    expect(classify({ outputUrl: `${R2}/files/j1.bin`, assetKind: null, outputData: {} })[0]!.kind).toBe("link")
  })
  it("off-allowlist media URL → link (host CSP would block the media element)", () => {
    const items = classify({ outputUrl: "https://evil.example.com/x.mp4", assetKind: "video", outputData: {} })
    expect(items[0]!.kind).toBe("link")
  })
  it("wildcard origin *.r2.cloudflarestorage.com matches subdomains only", () => {
    expect(classify({ outputUrl: "https://acct.r2.cloudflarestorage.com/j.mp4", assetKind: "video", outputData: {} })[0]!.kind).toBe("video")
    expect(classify({ outputUrl: "https://r2.cloudflarestorage.com/j.mp4", assetKind: "video", outputData: {} })[0]!.kind).toBe("link")
    expect(classify({ outputUrl: "https://evil.com/.r2.cloudflarestorage.com/j.mp4", assetKind: "video", outputData: {} })[0]!.kind).toBe("link")
  })

  // Rule 2 — known text keys, priority: script > lyrics > generatedText > alignment > text
  it("script object → formatted title + scenes with dialogue", () => {
    const script = {
      title: "My Film",
      scenes: [
        {
          sceneNumber: 1,
          sceneName: "Opening",
          visualDescription: "A city at dawn",
          action: "Camera pans across rooftops",
          dialogue: [{ character: "NARRATOR", line: "It begins." }],
        },
      ],
    }
    const items = classify({ outputUrl: null, assetKind: null, outputData: { script } })
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe("text")
    expect(items[0]!.title).toBe("My Film")
    expect(items[0]!.value).toContain("Scene 1 — Opening: A city at dawn")
    expect(items[0]!.value).toContain("Camera pans across rooftops")
    expect(items[0]!.value).toContain("NARRATOR: It begins.")
  })
  it("script scene missing expected fields → that scene pretty-printed as JSON", () => {
    const script = { title: "T", scenes: [{ weird: true }] }
    const items = classify({ outputUrl: null, assetKind: null, outputData: { script } })
    expect(items[0]!.value).toContain('"weird": true')
  })
  it("malformed script (no scenes array) → whole value as JSON", () => {
    const items = classify({ outputUrl: null, assetKind: null, outputData: { script: { foo: 1 } } })
    expect(items[0]!.kind).toBe("json")
  })
  it("lyrics array of variants → one titled text item per variant", () => {
    const lyrics = [
      { title: "Variant A", text: "la la" },
      { title: "Variant B", text: "do re" },
    ]
    const items = classify({ outputUrl: null, assetKind: null, outputData: { lyrics, sunoTaskId: "t" } })
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ kind: "text", title: "Variant A", value: "la la" })
    expect(items[1]).toEqual({ kind: "text", title: "Variant B", value: "do re" })
  })
  it("lyrics as plain string → single text item", () => {
    expect(classify({ outputUrl: null, assetKind: null, outputData: { lyrics: "words" } })[0])
      .toEqual({ kind: "text", value: "words" })
  })
  it("generatedText (image_to_text) → text", () => {
    expect(classify({ outputUrl: null, assetKind: null, outputData: { generatedText: "a cat" } })[0])
      .toEqual({ kind: "text", value: "a cat" })
  })
  it("alignment OUTRANKS text (forced_alignment writes both; text is the callers input transcript)", () => {
    const items = classify({
      outputUrl: null,
      assetKind: null,
      outputData: { alignment: [{ word: "hi", start: 0, end: 0.2 }], text: "hi" },
    })
    expect(items[0]!.kind).toBe("json")
    expect(items[0]!.value).toContain('"word": "hi"')
  })
  it("text (transcribe / style-boost) → text when no alignment present", () => {
    expect(classify({ outputUrl: null, assetKind: null, outputData: { text: "transcript", language: "en" } })[0])
      .toEqual({ kind: "text", value: "transcript" })
  })

  // Rule 3 — component fallback (arbitrary handle-id keys)
  it("component map: media URL + text values, underscore keys skipped", () => {
    const items = classify({
      outputUrl: null,
      assetKind: null,
      outputData: {
        "node-1": `${R2}/images/a.png`,
        "node-2": "some text output",
        _executionId: "e1",
        _appRunId: "r1",
      },
    })
    expect(items).toHaveLength(2)
    expect(items.find((i) => i.kind === "image")).toBeTruthy()
    expect(items.find((i) => i.kind === "text" && i.value === "some text output")).toBeTruthy()
  })
  it("component map: off-allowlist URL value → link, capped at 6 + overflow note", () => {
    const od: Record<string, string> = { bad: "https://other.example.com/a.png" }
    for (let i = 0; i < 9; i++) od[`k${i}`] = `text ${i}`
    const items = classify({ outputUrl: null, assetKind: null, outputData: od })
    expect(items.find((i) => i.value === "https://other.example.com/a.png")!.kind).toBe("link")
    // 10 candidates → 6 rendered + a trailing note so truncation is not silent
    expect(items.length).toBe(7)
    expect(items[6]).toEqual({ kind: "note", value: "+4 more in your Nodaro library" })
  })
  it("component map at exactly the cap → no overflow note", () => {
    const od: Record<string, string> = {}
    for (let i = 0; i < 6; i++) od[`k${i}`] = `text ${i}`
    const items = classify({ outputUrl: null, assetKind: null, outputData: od })
    expect(items.length).toBe(6)
    expect(items.every((i) => i.kind === "text")).toBe(true)
  })

  // Rule 4 — nothing resolvable
  it("empty outputData → empty array (widget shows library fallback)", () => {
    expect(classify({ outputUrl: null, assetKind: null, outputData: {} })).toEqual([])
    expect(classify({ outputUrl: null, assetKind: null })).toEqual([])
  })
})

describe("buildJobAutoWidget template", () => {
  const html = buildJobAutoWidget()
  it("embeds the classify function and the origin allowlist", () => {
    expect(html).toContain("function classifyJobOutput")
    expect(html).toContain("cdn.nodaro.ai")
  })
  it("polls get_asset with a 15-minute cap", () => {
    expect(html).toContain("15 * 60 * 1000")
    expect(html).toContain("get_asset")
  })
  it("has the library fallback ONLY as last resort strings", () => {
    expect(html).toContain("Open Nodaro library")
  })
  it("contains no innerHTML usage", () => {
    expect(html).not.toContain("innerHTML")
  })
  it("link renderer carries the http(s) scheme guard", () => {
    expect(html).toContain("indexOf('https://') === 0 || item.value.indexOf('http://') === 0")
  })
  it("carries the gated image follow-up buttons (display_asset image path)", () => {
    // Buttons render only when the tool result sets imageActions (display_asset),
    // and only on image media blocks — other job-auto consumers stay button-free.
    expect(html).toContain("appendImageActions")
    expect(html).toContain("item.kind === 'image' && state.imageActions")
    expect(html).toContain("animate this image: ")
    expect(html).toContain("modify this image: ")
    expect(html).toContain("pushUserMessage")
  })
  it("arms image click-to-fullscreen only on the gated display_asset path", () => {
    expect(html).toContain("requestDisplayMode")
    expect(html).toContain("image-ready")
    expect(html).toContain("classList.toggle('fullscreen'")
    // display-mode sync so the host X overlay (exit fullscreen) round-trips.
    expect(html).toContain("mcp-host-context-changed")
  })
})

describe("JOB_AUTO_TEXT_OUTPUT_KEYS stays in sync with the classify source", () => {
  // gallery.ts suppresses the get_asset no-URL warn for exactly these keys;
  // the classify function must render each of them (rule 2), in this order.
  // A key added to one side but not the other = warn spam or a silently
  // blank card — this drift guard fails first.
  it("every key is checked in JOB_AUTO_CLASSIFY_JS, in priority order", () => {
    let lastIndex = -1
    for (const key of JOB_AUTO_TEXT_OUTPUT_KEYS) {
      const index = JOB_AUTO_CLASSIFY_JS.indexOf(`od.${key} !== undefined`)
      expect(index, `classify has no rule-2 check for od.${key}`).toBeGreaterThan(lastIndex)
      lastIndex = index
    }
  })
})
