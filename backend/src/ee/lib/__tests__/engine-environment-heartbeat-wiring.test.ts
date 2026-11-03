// @test-watches backend/src/**/*.ts
/**
 * Who writes this environment's row, and when (decided 2026-11-03, "beat only
 * the claim"; engine-environments.ts):
 *
 * - The ENGINE RECORD is written as before the claim existed: once at boot,
 *   inside `buildApp`, so by every process that builds the app (the API
 *   server, the video worker's internal app, the video director), fire and
 *   forget.
 * - The PLATFORM CLAIM is written only by the API server's heartbeat, started
 *   once the server LISTENS and stopped first thing on SIGTERM, before
 *   `app.close()`, so a process on its way out claims nothing more.
 * - Only engine-environments.ts names the claim (its columns,
 *   `platformClaim`), however it is read (dotted, bracketed or destructured),
 *   and no source reads one out of `supports` (where the admin's view puts a
 *   fresh one), so none is read past its TTL.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND_SRC = join(HERE, "..", "..", "..")
const read = (file: string) => readFileSync(join(BACKEND_SRC, file), "utf8")
/**
 * A source without its comments, roughly: a block comment only where one starts (at a line's start or after a space,
 * so the `/*` of a string such as "image/*" never swallows the code after it), and a `//` not after a colon or a quote
 * (a URL keeps its own). So a doc may name what code may not.
 */
const stripComments = (text: string) => text.replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1 ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")
const code = (file: string) => stripComments(read(file))
const MODULE = "ee/lib/engine-environments.ts"

/** Every non-test TypeScript source under backend/src, as a path relative to it (forward slashes). */
function sources(dir = BACKEND_SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [relative(BACKEND_SRC, path).split(sep).join("/")] : []
  })
}
const sourcesMatching = (pattern: RegExp) => sources().filter((file) => file !== MODULE && pattern.test(code(file)))

/** A name of the claim itself: its two columns, and the field `listEngineEnvironments` reads them into. */
const CLAIM_NAME = /\b(?:platform_supports|platform_claimed_at|platformClaim)\b/
/** A claim read out of `supports`: dotted, bracketed, destructured from it, or destructured in a parameter. */
const CLAIM_IN_SUPPORTS = [
  /\bsupports\s*\??\.\s*platform\b/,
  /\bsupports\s*(?:\?\.)?\s*\[\s*["'`]platform["'`]\s*\]/,
  /\{[^{}]*\bplatform\b[^{}]*\}\s*=\s*[^;\n]*\bsupports\b/,
  /\bsupports\s*:\s*\{[^{}]*\bplatform\b/,
]
const readsClaimInSupports = (text: string) => CLAIM_IN_SUPPORTS.some((pattern) => pattern.test(text))

describe("this environment's row: the engine record at boot, the platform claim by the listening API server", () => {
  it("buildApp writes the engine record at boot, as before the claim (fire and forget), and starts no heartbeat", () => {
    const app = code("app.ts")
    expect(app.match(/void recordThisEngineEnvironment\(privatePlugins\.pluginBuildId \?\? null\)/g)).toHaveLength(1)
    expect(app).not.toMatch(/startPlatformClaimHeartbeat\(|recordPlatformClaim\(/)
  })

  it("every process that wrote it before still builds the app, so it still writes it at boot", () => {
    for (const file of ["server.ts", "lib/private-plugins/worker-app.ts", "video-director.ts"]) {
      expect(code(file), file).toMatch(/await buildApp\(\)/)
    }
  })

  it("server.ts starts the heartbeat once, after it listens", () => {
    const server = code("server.ts")
    const listen = server.indexOf("await app.listen(")
    const start = server.indexOf("startPlatformClaimHeartbeat(")
    expect(listen).toBeGreaterThan(-1)
    expect(start).toBeGreaterThan(listen)
    expect(server.match(/startPlatformClaimHeartbeat\(/g)).toHaveLength(1)
  })

  it("server.ts stops it first thing on SIGTERM, before any wait and before app.close(); on close too", () => {
    const server = code("server.ts")
    expect(server).toMatch(/process\.on\("SIGTERM", shutdown\)/)
    expect(server).toMatch(/const shutdown = async \(\) => \{\s*if \(shuttingDown\) return\s*shuttingDown = true\s*stopPlatformClaimHeartbeat\?\.\(\)/)
    const shutdown = server.slice(server.indexOf("const shutdown = async () => {"), server.indexOf('process.on("SIGTERM", shutdown)'))
    const stop = shutdown.indexOf("stopPlatformClaimHeartbeat?.()")
    expect(stop).toBeGreaterThan(-1)
    expect(stop).toBeLessThan(shutdown.indexOf("await "))
    expect(stop).toBeLessThan(shutdown.indexOf("app.close()"))
    expect(server).toMatch(/app\.addHook\("onClose", async \(\) => \{\s*stopPlatformClaimHeartbeat\?\.\(\)\s*\}\)/)
  })

  it("no other source writes the row: the boot write from app.ts, the heartbeat from server.ts, nothing else", () => {
    expect(sourcesMatching(/recordThisEngineEnvironment\(/)).toEqual(["app.ts"])
    expect(sourcesMatching(/startPlatformClaimHeartbeat\(/)).toEqual(["server.ts"])
    expect(sourcesMatching(/recordEngineEnvironment\(|recordPlatformClaim\(/)).toEqual([])
  })

  it("only engine-environments.ts names the claim, and none reads one out of `supports` (so none is read past its TTL)", () => {
    expect(sourcesMatching(CLAIM_NAME)).toEqual([])
    expect(sources().filter((file) => file !== MODULE && readsClaimInSupports(code(file)))).toEqual([])
  })

  it("the matchers catch a claim read every way (and leave other platforms, and comments, alone)", () => {
    expect(stripComments("// env.supports.platform\n/* row.platform_supports */ const url = 'https://x'")).not.toMatch(/supports\.platform|platform_supports/)
    expect(stripComments("const url = 'https://x'; f() // note")).toBe("const url = 'https://x'; f() ")
    // A string's "/*" is not a comment: the read after it is still seen.
    expect(stripComments('const accept = "image/*"; const p = env.supports.platform /* note */')).toMatch(/env\.supports\.platform/)
    expect(stripComments('const accept = "image/*"; const p = env.supports.platform /* note */')).not.toMatch(/note/)
    for (const text of ["row.platform_supports", "row['platform_claimed_at']", "env.platformClaim?.at", 'env["platformClaim"]', "const { platformClaim } = env", "({ platformClaim: c }) => c"]) {
      expect(CLAIM_NAME.test(text), text).toBe(true)
    }
    for (const text of ["platformClaimFresh(at)", "platform_supported", "const claim = platformOf(env)"]) {
      expect(CLAIM_NAME.test(text), text).toBe(false)
    }
    for (const text of [
      "env.supports.platform",
      "e.supports?.platform?.faceMeshMinFaceHeightPct",
      'env.supports["platform"]',
      "env.supports?.['platform']",
      "const { platform } = env.supports",
      "const { castSwap, platform: claim } = row.supports ?? {}",
      "({ supports: { platform } }) => platform",
    ]) {
      expect(readsClaimInSupports(text), text).toBe(true)
    }
    for (const text of ["process.platform", "os.platform()", "const { platform } = post", "const { platform, supports } = row", "env.supports.castSwap", "supports.platformName"]) {
      expect(readsClaimInSupports(text), text).toBe(false)
    }
  })
})
