/**
 * The MCP `transcribe` tool must run the engine it advertises.
 *
 * It always described itself as ElevenLabs STT (and exposes that engine's
 * diarize / audio-event options) but used to send NO `provider`, so the route's
 * fallback lane (`whisper`) served every call: `output_data.json.words` came back
 * `[]` on a job that reported success and charged credits, and the
 * diarize / tag options were silently ignored (2026-09-18 report). `whisper` has
 * no word-timestamp input in ANY published version, so the only honest fix on a
 * tool with no engine picker is to send a word-level engine explicitly — which
 * also makes the credit guard reserve on the id that actually runs.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TRANSCRIBE_PROVIDERS, TRANSCRIBE_PROVIDER_CAPABILITIES } from "@nodaro/shared/models"

const SRC = readFileSync(join(__dirname, "..", "verbs-audio.ts"), "utf8")
// The declaration lives in its own leaf (verbs-audio.ts imports and re-exports it).
const DECL_SRC = readFileSync(join(__dirname, "..", "_transcribe-provider.ts"), "utf8")

/**
 * A source guard has to read the source the way the COMPILER does, or it guards
 * nothing: this file's payload line sits under a long explanatory comment, and
 * a plain `block.includes("provider: MCP_TRANSCRIBE_PROVIDER")` passed happily
 * with the line commented OUT — the exact regression it exists to catch. Strip
 * comments first, then match the real statement. Line comments are anchored at
 * line start so a `https://…` inside a description string survives.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

function transcribeToolBlock(): string {
  const start = SRC.indexOf('"transcribe",')
  expect(start, "transcribe tool registration not found").toBeGreaterThan(-1)
  const end = SRC.indexOf("server.registerTool(", start)
  return stripComments(SRC.slice(start, end === -1 ? undefined : end))
}

describe("MCP transcribe engine", () => {
  const declared = /const MCP_TRANSCRIBE_PROVIDER: TranscribeProvider = "([^"]+)"/.exec(DECL_SRC)?.[1]

  it("pins an engine that is ENABLED on the route and word-level", () => {
    expect(declared, "MCP_TRANSCRIBE_PROVIDER declaration not found").toBeDefined()
    expect(TRANSCRIBE_PROVIDERS as readonly string[]).toContain(declared)
    expect(TRANSCRIBE_PROVIDER_CAPABILITIES[declared as keyof typeof TRANSCRIBE_PROVIDER_CAPABILITIES].wordTimestamps).toBe(true)
  })

  it("sends that engine in the dispatched payload (never relies on the route fallback)", () => {
    const block = transcribeToolBlock()
    // A LIVE statement, not the words appearing anywhere in the block: the
    // payload line must survive with its own line in the stripped source.
    expect(block).toMatch(/^\s*provider:\s*MCP_TRANSCRIBE_PROVIDER,/m)
    expect(block).toContain('url: "/v1/transcribe"')
  })

  it("names the same engine in the job widget", () => {
    expect(transcribeToolBlock()).toMatch(/model:\s*MCP_TRANSCRIBE_PROVIDER/)
  })

  it("the guard itself FAILS when the payload line is commented out", () => {
    // Pins the guard's own sensitivity: this is how it was broken (a `//` in
    // front of the payload line still matched the old `toContain` check).
    const commented = stripComments(`
      const payload = {
        audioUrl,
        // provider: MCP_TRANSCRIBE_PROVIDER,
      }
    `)
    expect(commented).not.toMatch(/^\s*provider:\s*MCP_TRANSCRIBE_PROVIDER,/m)
  })

  it("does not strip a URL inside a description string", () => {
    // Line comments are anchored at line start precisely so `https://…` in a
    // describe survives; an unanchored `//` rule would truncate the source and
    // could hide the payload line that follows on the same line.
    expect(stripComments('  description: "see https://nodaro.ai/docs",')).toContain(
      "https://nodaro.ai/docs",
    )
  })
})
