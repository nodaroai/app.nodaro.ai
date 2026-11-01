// @test-watches backend/src/providers/**/*.ts backend/src/workers/**/*.ts
/**
 * Every cloud wait a WORKER makes — the relays and the keyless provider
 * fallthrough under providers/ and workers/ — is queue-aware: a cloud job that
 * waits in line on the connected account never spends the relaying job's
 * budget (decided 2026-10-30: nothing fails for waiting). `waitForCloudJob`
 * stays plain by default, for the routes that wait inline in a request (the
 * scrapers, site capture — under routes/, not checked here), and `waitsAsJob`
 * keeps any request plain whatever it passes. A new worker-side call that
 * forgets `queueAware: true` fails here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SRC = fileURLToPath(new URL("../../../", import.meta.url))

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") out.push(...sources(path))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

/** The text of each `waitForCloudJob(...)` call in `text`, up to its closing parenthesis. */
function calls(text: string): string[] {
  const out: string[] = []
  const re = /\bwaitForCloudJob\(/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // The definition itself is not a call.
    if (/function\s+$/.test(text.slice(Math.max(0, m.index - 20), m.index))) continue
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")" && --depth === 0) break
    }
    out.push(text.slice(m.index, i + 1))
  }
  return out
}

describe("worker-side cloud waits are queue-aware", () => {
  const sites = ["providers", "workers"].flatMap((d) => sources(join(SRC, d)))
    .flatMap((file) => calls(readFileSync(file, "utf8")).map((call) => ({ file: relative(SRC, file), call })))

  it("finds the call sites", () => {
    // The exclusive relay, run-on-cloud, the image/video/audio fallthrough and the dialogue relay.
    expect(sites.length).toBeGreaterThanOrEqual(14)
  })

  it("every call passes queueAware: true", () => {
    const plain = sites.filter((s) => !/queueAware:\s*true/.test(s.call)).map((s) => `${s.file}: ${s.call.replace(/\s+/g, " ")}`)
    expect(plain).toEqual([])
  })
})
