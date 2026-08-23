/**
 * Provider hosts are configuration, not literals.
 *
 * `KIE_API_BASE` (providers/kie/client.ts) and `ELEVENLABS_BASE_URL`
 * (providers/elevenlabs/client.ts) are THE two consts every caller imports,
 * and both read `config`. A self-hoster pointing either at an egress proxy
 * that holds the real key gets nothing from that if one module keeps its own
 * copy of the host — and that is exactly the shape this codebase drifted
 * into: two local `const ELEVENLABS_BASE_URL` re-declarations shadowing the
 * shared export, plus four inline literals.
 *
 * So the rule is structural: the host strings appear in NO string or template
 * literal in backend source except the `config` defaults. Comments are exempt
 * — a doc line naming the vendor's host is not a call site — which falls out
 * of walking the AST rather than the text.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { eachSourceFile, lineOf, parse, walk } from "./source-scan.js"
import { baseUrl, config, envSchema } from "../config.js"

/** The single place each host is allowed to be spelled out. */
const ALLOWLIST = ["lib/config.ts"]

const HOSTS = ["api.kie.ai", "api.elevenlabs.io"]

/** Text of every string/template literal in a file, with its line. */
function literals(sf: ts.SourceFile): Array<{ text: string; line: number }> {
  const found: Array<{ text: string; line: number }> = []
  walk(sf, (n) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      found.push({ text: n.text, line: lineOf(sf, n) })
    }
  })
  return found
}

describe("provider base URLs are configuration", () => {
  it("spells each provider host only in the config default", () => {
    const offenders: string[] = []
    eachSourceFile((sf, rel) => {
      if (ALLOWLIST.includes(rel)) return
      for (const { text, line } of literals(sf)) {
        for (const host of HOSTS) {
          if (text.includes(host)) offenders.push(`${rel}:${line} — ${host}`)
        }
      }
    })
    expect(offenders).toEqual([])
  })

  it("the scanner sees literals and ignores comments (it IS the guard)", () => {
    // Without this the check above can silently pass on an empty haystack.
    const scan = (src: string) =>
      literals(ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true)).map((l) => l.text)

    expect(scan('const a = "https://api.kie.ai"').join()).toContain("api.kie.ai")
    expect(scan("const a = `https://api.kie.ai/x`").join()).toContain("api.kie.ai")
    expect(scan("// see https://api.kie.ai for docs").join()).not.toContain("api.kie.ai")
    expect(scan("/*\n * https://api.elevenlabs.io\n */").join()).not.toContain("api.elevenlabs.io")

    // The shapes a hand-rolled tokenizer gets wrong: a nested template ends
    // the outer one early, and a regex holding a quote flips string state.
    expect(scan("const u = `${c ? `${a}` : \"\"} x` // https://api.kie.ai").join())
      .not.toContain("api.kie.ai")
    expect(scan("const re = /['\"]/\nconst u = \"https://api.kie.ai\"").join())
      .toContain("api.kie.ai")
  })

  it("catches a literal reintroduced anywhere, including inside a template", () => {
    const sf = parse(new URL("../../providers/kie/client.ts", import.meta.url).pathname)
    expect(literals(sf).some((l) => l.text.includes("api.kie.ai"))).toBe(false)
  })

  it("defaults to the vendor hosts, so an unset env is byte-identical to before", () => {
    expect(config.KIE_API_BASE_URL).toBe("https://api.kie.ai")
    expect(config.ELEVENLABS_BASE_URL).toBe("https://api.elevenlabs.io")
  })

  describe("baseUrl()", () => {
    const parseUrl = (v?: string) => baseUrl("https://api.kie.ai").parse(v)

    it("falls back to the vendor host when unset, empty or blank", () => {
      expect(parseUrl(undefined)).toBe("https://api.kie.ai")
      expect(parseUrl("")).toBe("https://api.kie.ai")
      expect(parseUrl("   ")).toBe("https://api.kie.ai")
    })

    it("strips trailing slashes — every caller builds `${BASE}/path`", () => {
      expect(parseUrl("https://proxy.example.com/kie/")).toBe("https://proxy.example.com/kie")
      expect(parseUrl("https://proxy.example.com///")).toBe("https://proxy.example.com")
      expect(parseUrl("https://proxy.example.com/kie")).toBe("https://proxy.example.com/kie")
    })

    it("rejects a non-absolute URL at boot instead of at every provider call", () => {
      // Without this, `KIE_API_BASE_URL=api.kie.ai` (scheme forgotten) boots
      // green and then throws "Failed to parse URL" inside the worker on every
      // generation — after credits are reserved, with every LLM lane dead too.
      expect(() => parseUrl("api.kie.ai")).toThrow()
      expect(() => parseUrl("htttps://proxy.example.com")).toThrow()
      expect(() => parseUrl("https://")).toThrow()
      expect(parseUrl("http://minio.internal:9000")).toBe("http://minio.internal:9000")
    })
  })

  describe("R2_REGION", () => {
    const parseRegion = (v?: string) => envSchema.shape.R2_REGION.parse(v)

    it("treats a blank value as the default, not as an empty region", () => {
      // `.env.example` ships `R2_REGION=` blank and the compose file forwards
      // `${R2_REGION:-}`, so this arrives as "" — and zod `.default()` fires
      // only on undefined. `new S3Client({region: ""})` throws "Region is
      // missing" from the constructor, at import, killing the whole API with a
      // message that never names R2_REGION.
      expect(parseRegion(undefined)).toBe("auto")
      expect(parseRegion("")).toBe("auto")
      expect(parseRegion("   ")).toBe("auto")
    })

    it("passes a real region through", () => {
      expect(parseRegion("nyc3")).toBe("nyc3")
      expect(parseRegion("local")).toBe("local")
    })
  })
})
