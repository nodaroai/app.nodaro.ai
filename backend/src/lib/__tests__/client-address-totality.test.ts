/**
 * Every reader of a client address goes through `lib/client-address.ts`.
 *
 * Before that module existed, five places each read the leftmost
 * `X-Forwarded-For` entry themselves — and on Nodaro Cloud that entry was the
 * hosting platform's edge proxy, so every one of them keyed on ~22 shared
 * addresses (rate limits, free-grant signals, billing-key restrictions, report
 * dedup) without anything reporting it. A sixth hand-rolled read would
 * reintroduce exactly that, so it fails here instead.
 *
 * Parsed with the TypeScript compiler (`source-scan.ts`), not regexed: comments
 * are not AST nodes, so a `/*` inside a string or a line comment cannot hide
 * real code from the scan, and every shape below is matched structurally.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, lineOf, parseText, relPath, sourceFiles, walk } from "./source-scan.js"

/**
 * - lib/client-address.ts — the derivation itself.
 * - lib/log-redaction.ts — logs the SOCKET address of a request (an operations
 *   fact about the connection, never used to identify or limit anyone).
 */
const ALLOWLIST = new Set(["lib/client-address.ts", "lib/log-redaction.ts"])

/** Headers that carry a client address on some proxy or CDN. */
const ADDRESS_HEADERS = new Set([
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "forwarded",
  "x-client-ip",
  "x-cluster-client-ip",
  "fastly-client-ip",
])

/** Request properties that ARE an address (`req.ip`, `req.ips`, `socket.remoteAddress`). */
const ADDRESS_PROPERTIES = new Set(["ip", "ips", "remoteAddress"])

function literalText(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) return n.text
  return null
}

/** Each address read in one file, as "line: what". */
function addressReads(sf: ts.SourceFile): string[] {
  const found: string[] = []
  walk(sf, (n) => {
    const text = literalText(n)
    if (text !== null && ADDRESS_HEADERS.has(text.trim().toLowerCase())) {
      found.push(`${lineOf(sf, n)}: header "${text}"`)
    }
    if (ts.isPropertyAccessExpression(n) && ADDRESS_PROPERTIES.has(n.name.text)) {
      found.push(`${lineOf(sf, n)}: .${n.name.text}`)
    }
    if (ts.isElementAccessExpression(n)) {
      const key = literalText(n.argumentExpression)
      if (key !== null && ADDRESS_PROPERTIES.has(key)) found.push(`${lineOf(sf, n)}: ["${key}"]`)
    }
    if (ts.isBindingElement(n)) {
      const key = n.propertyName ?? n.name
      if (ts.isIdentifier(key) && ADDRESS_PROPERTIES.has(key.text)) found.push(`${lineOf(sf, n)}: { ${key.text} }`)
    }
  })
  return found
}

function readsIn(code: string): string[] {
  return addressReads(parseText("probe.ts", code))
}

describe("client addresses come from lib/client-address.ts only", { timeout: SCAN_TIMEOUT_MS }, () => {
  const files = sourceFiles()

  it("finds source files to check (the guard is wired to something)", () => {
    expect(files.length).toBeGreaterThan(200)
  })

  it("no other file reads a forwarding header or a request's address", () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = relPath(file)
      if (ALLOWLIST.has(rel)) continue
      const reads = addressReads(parseText(file, readFileSync(file, "utf8")))
      for (const r of reads) offenders.push(`src/${rel}:${r}`)
    }
    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These read a client address themselves:\n` +
          offenders.map((o) => `  - ${o}`).join("\n") +
          `\n\nUse lib/client-address.ts: clientAddress(req) for the address, ` +
          `clientNetworkHash(req) for a stored identity, rateLimitAddressKey(req) for a limiter key.`,
    ).toEqual([])
  })

  it("the allowlisted files still exist (an allowlist entry for a deleted file is a hole)", () => {
    const rels = new Set(files.map(relPath))
    for (const allowed of ALLOWLIST) expect(rels.has(allowed), allowed).toBe(true)
  })

  it("matches every shape it exists for (self-test)", () => {
    for (const code of [
      `const xff = req.headers["x-forwarded-for"]`,
      `req.headers['X-Real-IP']`,
      "headers[`cf-connecting-ip`]",
      `const h = "forwarded"`,
      `return req.ip || "unknown"`,
      `request.socket.remoteAddress`,
      `req.socket?.remoteAddress`,
      `req.raw.socket.remoteAddress`,
      `request.connection.remoteAddress`,
      `const all = req.ips`,
      `const { ip } = req`,
      `const { ip: who } = request`,
      `const a = req["ip"]`,
      `const a = fastifyRequest.ip`,
    ]) {
      expect(readsIn(code), code).not.toEqual([])
    }
  })

  it("every free-grant signal scopes an unknown address to its account", () => {
    // `ipHash` feeds signup_signals, whose network rules count OTHER accounts on
    // the same value. Unscoped, every claim with an unknown address would share
    // one value and withhold each other's grants.
    const writers: string[] = []
    const unscoped: string[] = []
    for (const file of files) {
      const text = readFileSync(file, "utf8")
      if (!text.includes("ipHash")) continue
      const sf = parseText(file, text)
      walk(sf, (n) => {
        if (!ts.isPropertyAssignment(n) || !ts.isIdentifier(n.name) || n.name.text !== "ipHash") return
        if (!ts.isCallExpression(n.initializer)) return
        const callee = n.initializer.expression
        if (!ts.isIdentifier(callee) || callee.text !== "callerKeyHash") return
        const where = `src/${relPath(file)}:${lineOf(sf, n)}`
        writers.push(where)
        const opts = n.initializer.arguments[1]
        const scoped =
          opts !== undefined &&
          ts.isObjectLiteralExpression(opts) &&
          opts.properties.some((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === "unknownScope")
        if (!scoped) unscoped.push(where)
      })
    }
    expect(writers.length, "the signal writers moved — update this guard").toBeGreaterThanOrEqual(3)
    expect(unscoped, `pass { unknownScope: userId } to callerKeyHash at:\n${unscoped.join("\n")}`).toEqual([])
  })

  it("is not fooled by comments or strings, and ignores neighbors", () => {
    // A `/*` inside a line comment used to open a fake block comment for a
    // regex stripper, hiding the code after it.
    expect(readsIn(`// media under uploads/*\nconst x = req.headers["x-forwarded-for"]\n/** doc */`)).toHaveLength(1)
    expect(readsIn(`const accept = "*/*;q=0.8"\nconst x = req.ip`)).toHaveLength(1)
    expect(readsIn(`// behind Caddy every request has req.ip 127.0.0.1`)).toEqual([])
    expect(readsIn(`req.headers["x-forwarded-host"]`)).toEqual([])
    expect(readsIn(`type S = { remoteAddress?: string }`)).toEqual([])
  })
})
