/**
 * What the public docs say about a node saved in Trailer mode, or in a mode
 * this app does not know, matches what the app does with it.
 *
 * Round 4 (decided 2026-10-06): an unknown or unplannable Edit Plan mode is
 * refused on every lane before anything is charged — the self-hosted relay
 * included: the video worker merges the relay handlers through the same mode
 * gate as the plugin's.
 *
 * Round 6 (decided 2026-10-06): what a self-host CONNECTED to nodaro.ai can
 * plan is what nodaro.ai plans (`withEditPlanModeGate(nodaroExclusiveRelayHandlers,
 * plannableEditPlanModes)` — the helper asks nodaro.ai, failing closed to the
 * three original modes). So the docs say a connected self-host gets Trailer as
 * soon as nodaro.ai plans it, charged to the connected account, and that a
 * Trailer node is refused before anything is relayed when nodaro.ai can't be
 * reached. The old line — a self-host lists no Trailer "because it plans no
 * mode itself" — is no longer true for a connected install and fails here.
 *
 * Round 7 (decided 2026-10-06): when nodaro.ai can't be reached, a Trailer job
 * on a connected self-host is a TEMPORARY error — the gate throws
 * `NodaroUnreachableError` ("could not reach nodaro.ai"), which the queue
 * retries — not a refusal. The docs say so, and give the editor's self-host
 * wording; the round-6 line ("refused … before anything is relayed" when
 * nodaro.ai can't be reached) fails here.
 *
 * The lead paragraph of each section must carry that exception too: "refused
 * before anything is charged, however it starts / on every lane" without it
 * contradicts the self-host outage text below it.
 *
 * Direction: code → docs. If the relay's gate stops reading the helper, the
 * first test fails: rewrite the docs to the new behaviour, then flip this test.
 * Anti-vacuity guards keep a renamed heading from passing silently.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, "..", "..", "..", "..")
const workerSrc = readFileSync(resolve(here, "..", "video-worker.ts"), "utf8")
const workerCode = workerSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const gateCode = readFileSync(resolve(here, "..", "..", "lib", "private-plugins", "edit-plan-mode-gate.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")

/** The body of the markdown section under `heading`, up to the next heading of the same or higher level. */
function section(file: string, heading: string): string {
  const md = readFileSync(resolve(REPO_ROOT, "docs", file), "utf8")
  const start = md.indexOf(`${heading}\n`)
  expect(start, `${file}: heading "${heading}" not found`).toBeGreaterThanOrEqual(0)
  const level = heading.match(/^#+/)![0].length
  const rest = md.slice(start + heading.length + 1)
  const next = rest.search(new RegExp(`^#{1,${level}} `, "m"))
  return (next === -1 ? rest : rest.slice(0, next)).replace(/\s+/g, " ")
}

const SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ["nodes/processing-video/edit-plan.md", "### When Trailer is greyed out"],
  ["api-integration.md", "### Edit Plan modes"],
]

describe("Edit Plan mode refusal: docs match the worker", () => {
  it("the self-hosted relay is merged through the mode gate, reading nodaro.ai's modes (the behaviour these docs describe)", () => {
    expect(workerCode).toMatch(/withEditPlanModeGate\(nodaroExclusiveRelayHandlers, plannableEditPlanModes\)/)
    expect(workerCode).not.toMatch(/Object\.assign\(allHandlers, nodaroExclusiveRelayHandlers\)/)
  })

  for (const [file, heading] of SECTIONS) {
    it(`${file} says a connected self-hosted install gets Trailer as soon as nodaro.ai plans it`, () => {
      const body = section(file, heading)
      expect(body).toMatch(/self-hosted install/i)
      expect(body).toMatch(/connected to nodaro\.ai/i)
      expect(body).toMatch(/as soon as nodaro\.ai plans trailers/i)
      expect(body).toMatch(/charged to the connected nodaro\.ai account/i)
    })

    it(`${file} says an outage is temporary: the Trailer job is retried, failing with "could not reach nodaro.ai"`, () => {
      expect(gateCode).toMatch(/verdict\.kind === "nodaro-unreachable"\) throw new NodaroUnreachableError\(\)/)
      const body = section(file, heading)
      expect(body).toMatch(/can't be reached/i)
      expect(body).toMatch(/temporary/i)
      expect(body).toMatch(/retried/i)
      expect(body).toMatch(/could not reach nodaro\.ai/)
      expect(body).not.toMatch(/refuses a node saved in Trailer mode on the install/i)
      expect(body).not.toMatch(/is refused on the install, before anything is relayed/i)
    })

    it(`${file} gives a connected self-host's wording, and keeps "needs a plugin update" for nodaro.ai`, () => {
      const body = section(file, heading)
      expect(body).toMatch(/Available once nodaro\.ai supports it/)
      expect(body).toMatch(/Couldn't reach nodaro\.ai — try again later/)
      expect(body).toMatch(/needs a plugin update/)
    })

    it(`${file} qualifies "refused before anything is charged": a connected self-host that can't reach nodaro.ai retries instead`, () => {
      const body = section(file, heading)
      // One sentence (no ". " inside) that states the refusal AND its exception.
      expect(body).toMatch(
        /refused before anything is charged(?:(?!\. )[\s\S])*?\bexcept\b(?:(?!\. )[\s\S])*?can't reach (?:it|nodaro\.ai)(?:(?!\. )[\s\S])*?retried/i,
      )
    })

    it(`${file} no longer says a self-host never lists Trailer because it plans no mode itself`, () => {
      const body = section(file, heading)
      expect(body).not.toMatch(/plans? no mode (it|them)sel(f|ves)/i)
    })
  }

  it("edit-plan.md says a saved Trailer node's notice gives the reason, not always \"cannot plan a trailer yet\"", () => {
    const body = section("nodes/processing-video/edit-plan.md", "### When Trailer is greyed out")
    expect(body).not.toMatch(/shows a notice that this server cannot plan a trailer yet/i)
    expect(body).toMatch(/notice (?:with|giving) the reason/i)
  })

  it("edit-plan.md says an unknown mode is refused, never planned as Tighten", () => {
    const md = readFileSync(resolve(REPO_ROOT, "docs", "nodes/processing-video/edit-plan.md"), "utf8")
    const start = md.indexOf("### An unknown mode\n")
    expect(start, "heading \"### An unknown mode\" not found").toBeGreaterThanOrEqual(0)
    const body = md.slice(start, md.indexOf("\n#", start + 1)).replace(/\s+/g, " ")
    expect(body).toMatch(/refused/i)
    expect(body).toMatch(/never planned as Tighten/i)
  })
})
