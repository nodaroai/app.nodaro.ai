import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_DOCS_ALIASES, NODE_DOCS_SECTIONS } from "../node-docs-map.generated"
import { NODE_DOCS_SECTION_IDS, docsUrlForNode, nodeDocsHasSection, nodeDocsSections, nodeDocsSummaryFrom } from "../node-docs"

interface SnapshotNode {
  readonly type: string
  readonly summary: string
  readonly summaries?: Readonly<Record<string, string>>
  readonly sections: readonly string[]
}

/** The generated summary chunks, by language (the file name). */
const SUMMARY_CHUNKS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<{ NODE_DOCS_SUMMARIES: Readonly<Record<string, string>> }>("../summaries/*.generated.ts", { eager: true }),
  ).map(([path, m]) => [path.slice("../summaries/".length, -".generated.ts".length), m.NODE_DOCS_SUMMARIES]),
)
interface Snapshot {
  readonly sections: Readonly<Record<string, string>>
  readonly aliases: Readonly<Record<string, string>>
  readonly nodes: readonly SnapshotNode[]
}

const snapshot: Snapshot = JSON.parse(readFileSync(join(__dirname, "..", "node-docs-links.json"), "utf-8"))

/**
 * Picker nodes whose docs page is not published yet, each with the reason. A
 * new node in the picker fails this file until its page exists (or it is
 * listed here), so every node the editor offers gets a page. An entry must
 * leave once its page is in the snapshot: the test fails while it lingers.
 *
 * A node the deployment's availability settings hide from users is not
 * `adminOnly` in code, so it is listed here rather than skipped.
 */
const AWAITING_DOCS_PAGE: Readonly<Record<string, string>> = {
  "meta-ads-scrape": "hidden from users in production (availability settings); the page is written and held until release",
  "instagram-scrape": "hidden from users in production (availability settings); the page is written and held until release",
  "camera-switch": "new node (podcast multicam); the in-repo page is docs/nodes/processing-video/camera-switch.md and the docs-site page follows its release",
  "speaker-view": "new node (podcast Speaker View); the in-repo page is docs/nodes/processing-video/speaker-view.md and the docs-site page follows its release",
  "speaker-frames": "new node (podcast face tracks, P3.6); the in-repo page is docs/nodes/processing-video/speaker-frames.md and the docs-site page follows its release",
}

const hasPage = (type: string) => type in NODE_DOCS_SECTIONS || type in NODE_DOCS_ALIASES

// An admin-only node is a preview; its page is written when it opens to everyone.
const pickerTypes: readonly string[] = [...new Set(NODE_OPTIONS.filter((o) => !o.adminOnly).map((o) => o.type))]

describe("docsUrlForNode", () => {
  it("builds every link from the node type, with ref=app and the interface language", () => {
    expect(docsUrlForNode("generate-image")).toBe("https://nodaro.ai/docs/node/generate-image?ref=app")
    expect(docsUrlForNode("generate-image", { lang: "he" })).toBe("https://nodaro.ai/docs/node/generate-image?lang=he&ref=app")
    expect(docsUrlForNode("generate-image", { lang: "pt-BR", section: "models" })).toBe(
      "https://nodaro.ai/docs/node/generate-image?lang=pt-BR&ref=app#models",
    )
  })

  it("links a type with no page like any other: the docs site redirects it to the node reference", () => {
    expect(docsUrlForNode("no-such-node", { lang: "en" })).toBe("https://nodaro.ai/docs/node/no-such-node?lang=en&ref=app")
    expect(nodeDocsSections("no-such-node")).toEqual([])
  })
})

describe("a page's summary", () => {
  const byLang = new Map<string, Readonly<Record<string, string>>>([
    ["ja", { "generate-image": "日本語の要約" }],
    ["pt-br", { "generate-image": "Resumo em português" }],
    ["en", { "generate-image": "English summary", "trim-video": "English only" }],
  ])

  it("is in the interface language when the page is translated into it", () => {
    expect(nodeDocsSummaryFrom(byLang, "ja", "generate-image")).toBe("日本語の要約")
    // Language ids match in any letter case.
    expect(nodeDocsSummaryFrom(byLang, "pt-BR", "generate-image")).toBe("Resumo em português")
  })

  it("falls back to English when the page is not translated into it, or the language not at all", () => {
    expect(nodeDocsSummaryFrom(byLang, "ja", "trim-video")).toBe("English only")
    expect(nodeDocsSummaryFrom(byLang, "he", "generate-image")).toBe("English summary")
  })

  it("is read through an alias, and absent for a type with no page", () => {
    expect(nodeDocsSummaryFrom(new Map([["en", { "generate-video": "Video" }]]), "en", "text-to-video")).toBe("Video")
    expect(nodeDocsSummaryFrom(byLang, "en", "no-such-node")).toBeUndefined()
  })
})

describe("the sections of a node's page", () => {
  it("are read through an alias for a type documented on another node's page", () => {
    for (const [from, to] of Object.entries(snapshot.aliases)) {
      expect(nodeDocsSections(from)).toEqual(nodeDocsSections(to))
    }
  })

  it("answer whether a deep link exists", () => {
    const withModels = snapshot.nodes.find((n) => n.sections.includes("models"))!
    const withoutModels = snapshot.nodes.find((n) => !n.sections.includes("models"))!
    expect(nodeDocsHasSection(withModels.type, "models")).toBe(true)
    expect(nodeDocsHasSection(withoutModels.type, "models")).toBe(false)
  })
})

describe("the node-docs snapshot", () => {
  it("matches the generated maps (after replacing the snapshot, run npm -w frontend run gen:node-docs)", () => {
    expect(Object.keys(NODE_DOCS_SECTIONS).sort()).toEqual(snapshot.nodes.map((n) => n.type).sort())
    for (const node of snapshot.nodes) {
      expect(NODE_DOCS_SECTIONS[node.type], node.type).toEqual(node.sections)
    }
    expect(NODE_DOCS_ALIASES).toEqual(snapshot.aliases)
  })

  it("has one summary chunk per language the docs translate, English for every page", () => {
    const langs = new Set(["en", ...snapshot.nodes.flatMap((n) => Object.keys(n.summaries ?? {}))])
    expect(Object.keys(SUMMARY_CHUNKS).sort()).toEqual([...langs].sort())
    for (const node of snapshot.nodes) {
      expect(SUMMARY_CHUNKS.en[node.type], node.type).toBe(node.summaries?.en ?? node.summary)
      for (const [lang, text] of Object.entries(node.summaries ?? {})) {
        expect(SUMMARY_CHUNKS[lang][node.type], `${lang} ${node.type}`).toBe(text)
      }
    }
  })

  it("uses only the section ids the interface has a label for", () => {
    expect(Object.keys(snapshot.sections).sort()).toEqual([...NODE_DOCS_SECTION_IDS].sort())
  })
})

describe("every node in the picker", () => {
  it("has a docs page", () => {
    const missing = pickerTypes.filter((t) => !hasPage(t) && !(t in AWAITING_DOCS_PAGE))
    expect(missing, "write the node's page on the docs site and refresh the snapshot, or list it in AWAITING_DOCS_PAGE").toEqual([])
  })

  it("lists only nodes still waiting for a page in AWAITING_DOCS_PAGE", () => {
    const stale = Object.keys(AWAITING_DOCS_PAGE).filter((t) => hasPage(t) || !pickerTypes.includes(t))
    expect(stale, "its page exists now, or it left the picker: drop it from AWAITING_DOCS_PAGE").toEqual([])
  })
})

describe("links to the docs", () => {
  const src = join(__dirname, "..", "..", "..")
  const home = join(src, "lib", "node-docs")

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === "__tests__" || path === home ? [] : sourceFiles(path)
      return /\.(ts|tsx)$/.test(name) ? [path] : []
    })
  }

  it("are built only by docsUrlForNode, never by hand (a page URL moves; /docs/node/{type} does not)", () => {
    const byHand = sourceFiles(src)
      .filter((file) => readFileSync(file, "utf-8").includes("nodaro.ai/docs/node"))
      .map((file) => relative(src, file))
    expect(byHand).toEqual([])
  })

  it("are hidden wherever platform links are: every renderer checks nodeDocsLinksShown()", () => {
    const unchecked = sourceFiles(src)
      .filter((file) => {
        const text = readFileSync(file, "utf-8")
        return /\b(useNodeDocsUrl|docsUrlForNode)\(/.test(text) && !text.includes("nodeDocsLinksShown()")
      })
      .map((file) => relative(src, file))
    expect(unchecked).toEqual([])
  })
})
