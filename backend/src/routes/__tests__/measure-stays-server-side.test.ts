// @test-watches backend/src/routes/*.ts backend/src/nodes/*/route*.ts backend/src/lib/video-utility-length.ts backend/src/lib/request-measure.ts
/**
 * What a measuring route's preHandler measured before its charge — a length, a
 * held row, the units it prices — is kept on the SERVER-SIDE request
 * (`lib/request-measure.ts`, `req.probedDuration`, `req.probedCreditId`),
 * never on the body a client sends: a body field is one a client can set
 * itself, and the credit guard or the handler reading it would let a client
 * choose its own price on any path that reaches them without the preHandler
 * overwriting it (decided 2026-11-14). This holds every route file — the route
 * files and every node unit's route (`unitRouteFiles`) — to that, with no
 * exception: no write of a `__`-named field, or of a named stash key, onto the
 * request body, and no read of one off it (a client's copy may only be
 * dropped: `dropClientMeasureFields`, or a destructure into an `_`-named
 * binding that is never used). A regex scan, the cheap first line: it does
 * not follow an alias of the body (`const b = req.body`), nor a helper the
 * body is handed to; each measuring route also has a route test that a
 * client-sent stash value is ignored.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { unitRouteFiles } from "../../lib/unit-source-files.js"

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const ROUTES = join(SRC, "routes")
const REPO_ROOT = join(SRC, "..", "..")

/** A source without its comments, roughly (a doc may name what code may not). */
const stripComments = (text: string) => text.replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1 ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")

/** A request body as route code names it: `body`, `req.body`, `rawBody`, or one cast `(req.body as …)` / `(body as …)`. */
const BODY = String.raw`(?:\breq\.body|\b\w*[bB]ody\b|\((?:req\.)?\w*[bB]ody(?:\s*\?\?\s*\{\})?\s+as\s+[^)]*\))`
/** A stash field on it: `.__x`, `?.__x`, `[KEY]`, `?.[KEY]`, `["__x"]`. */
const FIELD = String.raw`\s*(?:\?\.|\.)\s*__\w+|\s*(?:\?\.)?\s*\[(?:[A-Z][A-Z0-9_]*|["'\x60]__\w+["'\x60])\]`

/** A write of a measure onto the request body: `body.__x =`, `body[KEY] =`, `(req.body as …).__x =`. */
const BODY_STASH_WRITE = new RegExp(`${BODY}(?:${FIELD})\\s*=(?!=)`)
/** A read of one off it: the same access, not assigned to. */
const BODY_STASH_READ = new RegExp(`${BODY}(?:${FIELD})(?!\\s*=(?!=))`)
/** A destructure that keeps a stash field off a body under a name it uses (`{ [KEY]: units, …rest } = req.body`); an `_`-named binding only drops it. */
const BODY_STASH_DESTRUCTURE = new RegExp(String.raw`(?:\{|,)\s*(?:__\w+|\[[A-Z][A-Z0-9_]*\])\s*:\s*(?!_)[A-Za-z$][\w$]*[^;]*?\}\s*=\s*\(?\s*${BODY}`)

const offences = (code: string): string[] =>
  [BODY_STASH_WRITE, BODY_STASH_READ, BODY_STASH_DESTRUCTURE].flatMap((re) => code.match(re)?.[0] ?? [])

const routeFiles = readdirSync(ROUTES).filter((f) => f.endsWith(".ts"))
/** Every node unit's route, by its path from the repo root. */
const unitRoutes = unitRouteFiles(REPO_ROOT).map((path) => ({ label: relative(REPO_ROOT, path).split(sep).join("/"), path }))

describe("a measuring route keeps what it measured on the server-side request, never the body", () => {
  it.each(routeFiles)("%s neither writes a measure onto the body nor reads one off it", (file) => {
    expect(offences(stripComments(readFileSync(join(ROUTES, file), "utf8")))).toEqual([])
  })

  it.each(unitRoutes.map((r) => [r.label, r.path]))("%s neither writes a measure onto the body nor reads one off it", (_label, path) => {
    expect(offences(stripComments(readFileSync(path, "utf8")))).toEqual([])
  })

  it("Trim, Loop and Combine Videos' shared measure (lib/video-utility-length.ts) does the same", () => {
    const code = stripComments(readFileSync(join(SRC, "lib", "video-utility-length.ts"), "utf8"))
    expect(offences(code)).toEqual([])
    expect(code).toMatch(/setRequestMeasure\(/)
  })

  it("the patterns catch what they are for (a guard that matches nothing guards nothing)", () => {
    expect(offences("body.__maskEraseUnits = measured.units")).not.toEqual([])
    expect(offences("body[STASH] = measured.units")).not.toEqual([])
    expect(offences("const u = (body as Record<string, unknown> | undefined)?.__maskEraseUnits")).not.toEqual([])
    expect(offences("trimSourceToFrames: (req.body as Record<string, unknown>).__trimSourceToFrames as number | undefined,")).not.toEqual([])
    expect(offences("const { [STASH]: billedUnits, ...raw } = (req.body ?? {}) as Record<string, unknown>")).not.toEqual([])
    expect(offences('body["__probedDuration"] = 3')).not.toEqual([])
    expect(offences("const d = req.body['__probedDuration']")).not.toEqual([])
    // Dropping a client's copy is allowed.
    expect(offences("const { [STASH]: _stash, ...raw } = (req.body ?? {}) as Record<string, unknown>")).toEqual([])
    expect(offences("dropClientMeasureFields(req.body, [STASH])")).toEqual([])
  })
})
