// @test-watches backend/src/**/*.ts
/**
 * No AsyncLocalStorage store is a request or a reply.
 *
 * A store lives as long as any async context that captured it, and a finished
 * request's context outlives the request: a keep-alive connection that stays
 * open after its answer keeps the context of the request it served, and so
 * does a timer or a pooled connection the request started. A store that IS
 * the Fastify request (or its reply, or the raw Node request/response) keeps
 * everything those reach, which for `POST /mcp` is the whole MCP server the
 * request built (tens of MB per open connection). That happened twice
 * (lib/request-user-scope.ts, and the concurrency lanes' request scope through
 * a getter that captured the reply).
 *
 * The census, over every backend source file:
 *  - every `new AsyncLocalStorage` names its store type, so this can read it;
 *  - no store type is a request or a reply (`| undefined` / `| null` aside);
 *  - a store type that mentions one (an object type holding a request, written
 *    inline or declared in the same file) is listed in RELEASED_HOLDERS with
 *    where it lets the request go.
 *
 * What a census cannot see: a store that reaches a request through a closure
 * (the lanes' getter was one) or through a type declared in another file. The
 * behavioural tests pin those: lib/__tests__/request-user-scope.test.ts,
 * lib/concurrency-lanes/__tests__/request-scope-release.test.ts and the
 * whole-app __tests__/idle-connection-retention.test.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND_SRC = join(HERE, "..", "..")

/** Store types that hold a request and say where they let it go. Paths from backend/src. */
const RELEASED_HOLDERS: Readonly<Record<string, string>> = {
  "lib/request-user-scope.ts":
    "holds the request while it is live and drops it when the raw response closes, keeping the user id it had then and, only when the client left before the reply was sent (its hooks may still run), a weak reference to it",
}

const REQUEST_TYPES = ["FastifyRequest", "FastifyReply", "IncomingMessage", "ServerResponse", "RawRequestDefaultExpression", "RawReplyDefaultExpression"]
const MENTIONS_REQUEST = new RegExp(`\\b(?:${REQUEST_TYPES.join("|")})\\b`)
/** A type that IS one of them: `FastifyRequest`, `FastifyRequest<…>`, `http.IncomingMessage`. */
const IS_REQUEST = new RegExp(`^(?:\\w+\\.)?(?:${REQUEST_TYPES.join("|")})\\b`)

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || name === "_generated") continue
      out.push(...sourceFiles(path))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

/** The text between the `<` at `open` and its matching `>`, or null. */
function typeArgument(code: string, open: number): string | null {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    const ch = code[i]
    if (ch === "<") depth++
    else if (ch === ">" && code[i - 1] !== "=") {
      depth--
      if (depth === 0) return code.slice(open + 1, i)
    }
  }
  return null
}

/** The declaration of `name` in the same file (an interface or a type alias), or "". */
function localDeclaration(code: string, name: string): string {
  const iface = new RegExp(`interface\\s+${name}\\b[^{]*\\{`).exec(code)
  if (iface) {
    let depth = 0
    for (let i = iface.index + iface[0].length - 1; i < code.length; i++) {
      if (code[i] === "{") depth++
      else if (code[i] === "}" && --depth === 0) return code.slice(iface.index, i + 1)
    }
  }
  const alias = new RegExp(`type\\s+${name}\\b[^=]*=([^;]*)`).exec(code)
  return alias ? alias[0] : ""
}

interface Store {
  file: string
  type: string | null
  /** The store type plus the same-file declarations of the names it uses. */
  expanded: string
}

const stores: Store[] = sourceFiles(BACKEND_SRC).flatMap((path) => {
  const code = withoutComments(readFileSync(path, "utf8"))
  const file = relative(BACKEND_SRC, path).split(sep).join("/")
  const found: Store[] = []
  for (const m of code.matchAll(/new\s+AsyncLocalStorage\s*(<)?/g)) {
    const type = m[1] ? typeArgument(code, m.index! + m[0].length - 1) : null
    const names = type ? [...type.matchAll(/\b[A-Z]\w*\b/g)].map((n) => n[0]) : []
    const expanded = [type ?? "", ...names.map((n) => localDeclaration(code, n))].join("\n")
    found.push({ file, type: type?.trim() ?? null, expanded })
  }
  return found
})

const bare = (type: string) =>
  type
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "undefined" && part !== "null")

describe("AsyncLocalStorage stores", () => {
  it("finds the stores it is about (the census is not vacuous)", () => {
    const files = stores.map((s) => s.file)
    for (const known of ["lib/request-user-scope.ts", "lib/concurrency-lanes/hold.ts", "lib/job-cancellation.ts"]) {
      expect(files).toContain(known)
    }
  })

  it("every store names its type", () => {
    expect(stores.filter((s) => s.type === null).map((s) => s.file)).toEqual([])
  })

  it("no store is a request or a reply", () => {
    const offenders = stores.filter((s) => s.type !== null && bare(s.type).some((part) => IS_REQUEST.test(part)))
    expect(offenders.map((s) => `${s.file}: AsyncLocalStorage<${s.type}>`)).toEqual([])
  })

  it("a store that holds a request says where it lets it go", () => {
    const holding = [...new Set(stores.filter((s) => MENTIONS_REQUEST.test(s.expanded)).map((s) => s.file))].sort()
    expect(holding).toEqual(Object.keys(RELEASED_HOLDERS).sort())
  })
})
