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
 * So the rule is structural: the host strings appear NOWHERE in backend
 * source except the `config` defaults. Comments are exempt (a doc line
 * naming the vendor's host is not a call site) — which is why this walks the
 * source with a tokenizer instead of a regex: `//` inside `https://` would
 * make a naive comment-strip swallow every literal and pass forever.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { baseUrl, config } from "../config.js"

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

/** The single place each host is allowed to be spelled out. */
const ALLOWLIST = ["lib/config.ts"]

const HOSTS = ["api.kie.ai", "api.elevenlabs.io"]

/**
 * Blank out comments while preserving offsets' line structure. String and
 * template bodies are kept verbatim — they are the thing under test.
 */
function stripComments(src: string): string {
  type Mode = "code" | "line" | "block" | "sq" | "dq" | "tpl"
  let mode: Mode = "code"
  let out = ""
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    const n = src[i + 1]
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue }
      if (c === "'") mode = "sq"
      else if (c === '"') mode = "dq"
      else if (c === "`") mode = "tpl"
      out += c; i++; continue
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c }
      i++; continue
    }
    if (mode === "block") {
      if (c === "*" && n === "/") { mode = "code"; i += 2; continue }
      if (c === "\n") out += c
      i++; continue
    }
    // inside a string/template body
    if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code"
    }
    out += c; i++
  }
  return out
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // Tests legitimately spell a host out — they mock the const's value.
      if (entry === "__tests__" || entry === "node_modules") continue
      sourceFiles(full, acc)
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      acc.push(full)
    }
  }
  return acc
}

describe("provider base URLs are configuration", () => {
  it("spells each provider host only in the config default", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join("/")
      if (ALLOWLIST.includes(rel)) continue
      const code = stripComments(readFileSync(file, "utf8"))
      code.split("\n").forEach((line, idx) => {
        for (const host of HOSTS) {
          if (line.includes(host)) offenders.push(`${rel}:${idx + 1} — ${host}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it("the tokenizer keeps string bodies and drops comments (it is the guard)", () => {
    // Without this the previous test can silently pass on an empty haystack.
    expect(stripComments('const a = "https://api.kie.ai"')).toContain("api.kie.ai")
    expect(stripComments("// see https://api.kie.ai for docs")).not.toContain("api.kie.ai")
    expect(stripComments("/*\n * https://api.elevenlabs.io\n */")).not.toContain("api.elevenlabs.io")
    expect(stripComments("const u = `${B}/v1` // https://api.kie.ai")).toContain("${B}/v1")
  })

  it("defaults to the vendor hosts, so an unset env is byte-identical to before", () => {
    expect(config.KIE_API_BASE_URL).toBe("https://api.kie.ai")
    expect(config.ELEVENLABS_BASE_URL).toBe("https://api.elevenlabs.io")
  })

  describe("baseUrl()", () => {
    const parse = (v?: string) => baseUrl("https://api.kie.ai").parse(v)

    it("falls back to the vendor host when unset, empty or blank", () => {
      expect(parse(undefined)).toBe("https://api.kie.ai")
      expect(parse("")).toBe("https://api.kie.ai")
      expect(parse("   ")).toBe("https://api.kie.ai")
    })

    it("strips trailing slashes — every caller builds `${BASE}/path`", () => {
      expect(parse("https://proxy.example.com/kie/")).toBe("https://proxy.example.com/kie")
      expect(parse("https://proxy.example.com///")).toBe("https://proxy.example.com")
      expect(parse("https://proxy.example.com/kie")).toBe("https://proxy.example.com/kie")
    })
  })
})
