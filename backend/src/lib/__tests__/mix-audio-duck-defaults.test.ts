import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { DUCK_DEFAULT_AMOUNT, DUCK_DEFAULTS, duckRatioFromAmount } from "../mix-audio-duck.js"

/**
 * The duck defaults live in ONE place (`lib/mix-audio-duck.ts`) but are quoted
 * in places that cannot import it: the editor (a separate bundle), the CLI
 * help, and the public docs. The MCP verb derives its text from the
 * constants directly. This test reads every other copy that quotes a default
 * (docs/cli.md quotes none: its flag line carries only ranges) and fails when
 * one drifts, so changing a default is a one-line edit that this test then walks
 * you through.
 */
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const read = (rel: string) => readFileSync(resolve(repo, rel), "utf8")

describe("duck defaults agree across every surface", () => {
  it("the editor's starting amount is the server default", () => {
    const m = read("frontend/src/lib/mix-audio-duck.ts").match(/MIX_DUCK_DEFAULT_AMOUNT\s*=\s*(\d+)/)
    expect(m, "MIX_DUCK_DEFAULT_AMOUNT not found in frontend/src/lib/mix-audio-duck.ts").not.toBeNull()
    expect(Number(m![1])).toBe(DUCK_DEFAULT_AMOUNT)
  })

  it("the CLI help quotes the default amount", () => {
    expect(read("packages/cli/src/commands/audio.ts")).toContain(`(default ${DUCK_DEFAULT_AMOUNT})`)
  })

  it("the REST/SDK reference quotes every default", () => {
    const row = read("docs/api-integration.md")
      .split("\n")
      .find((l) => l.includes("/v1/mix-audio"))
    expect(row).toBeDefined()
    expect(row).toContain(`default ${DUCK_DEFAULT_AMOUNT}`)
    expect(row).toContain(`\`thresholdDb\` default ${DUCK_DEFAULTS.thresholdDb}`)
    expect(row).toContain(`\`attackMs\` ${DUCK_DEFAULTS.attackMs}`)
    expect(row).toContain(`\`releaseMs\` ${DUCK_DEFAULTS.releaseMs}`)
  })

  it("the SDK reference and the SDK's own JSDoc quote every default", () => {
    for (const rel of ["docs/sdk-reference.md", "packages/client/src/resources/audio.ts"]) {
      const text = read(rel)
      expect(text, `${rel} amount`).toContain(`default ${DUCK_DEFAULT_AMOUNT}`)
      expect(text, `${rel} thresholdDb`).toContain(`\`thresholdDb\` (-60–0, default ${DUCK_DEFAULTS.thresholdDb})`)
      expect(text, `${rel} attackMs`).toContain(`\`attackMs\` (1–2000, default ${DUCK_DEFAULTS.attackMs})`)
      expect(text, `${rel} releaseMs`).toContain(`\`releaseMs\` (10–9000, default ${DUCK_DEFAULTS.releaseMs})`)
    }
  })

  it("the MCP tool page quotes the default amount", () => {
    const row = read("docs/mcp/tools.md")
      .split("\n")
      .find((l) => l.startsWith("| `mix_audio`"))
    expect(row).toBeDefined()
    expect(row).toContain(`(default ${DUCK_DEFAULT_AMOUNT})`)
  })

  it("the node page's defaults table, ratio table and worked example agree", () => {
    const page = read("docs/nodes/processing-audio/mix-audio.md")
    expect(page).toContain(`| Duck amount (\`duckAmount\`) | Slider | ${DUCK_DEFAULT_AMOUNT}% |`)
    expect(page).toContain(`| \`thresholdDb\` | ${DUCK_DEFAULTS.thresholdDb} dBFS |`)
    expect(page).toContain(`| \`attackMs\` | ${DUCK_DEFAULTS.attackMs} |`)
    expect(page).toContain(`| \`releaseMs\` | ${DUCK_DEFAULTS.releaseMs} |`)
    expect(page).toContain(`| ${DUCK_DEFAULT_AMOUNT} (default) | ${duckRatioFromAmount(DUCK_DEFAULT_AMOUNT)} |`)
    expect(page).toContain(`default **Duck amount** of ${DUCK_DEFAULT_AMOUNT}`)
    expect(page).toContain(`the ${DUCK_DEFAULTS.thresholdDb} dBFS threshold`)
    expect(page).toContain(`within about ${DUCK_DEFAULTS.attackMs} ms`)
    expect(page).toContain(`over about ${DUCK_DEFAULTS.releaseMs} ms`)
  })
})
