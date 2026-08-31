/**
 * Cross-surface parity guard for the voice-changer-pro ORDERED-VOICE shape.
 *
 * The per-voice object exists as uncoordinated copies on every surface — the
 * plugin's zod (the wire AUTHORITY, in nodaro-cloud-plugins), the MCP verb's
 * zod, the SDK type, and the frontend node-data type — with nothing keeping
 * them aligned. That is exactly how `stability`/`seed` silently stopped
 * surviving a workflow run once (the payload-builder flatten bug), and how a
 * new lever (like `engine`) could ship on one surface and be stripped on
 * another.
 *
 * This is a SOURCE-text guard: each surface's ordered-voice region must name
 * every canonical key. It cannot verify the plugin package (not in this
 * tree) — the canonical list below mirrors its wire schema; when the wire
 * gains a key, add it here and the failures point at every copy to update.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../..")

/** The per-voice wire-object keys (authority: the private cloud-plugins
 *  package's recast route schema — keep this list in step with it). */
const CANONICAL_KEYS = [
  "voiceId",
  "engine",
  "stability",
  "similarityBoost",
  "style",
  "useSpeakerBoost",
  "seed",
  "volumeMode",
  "volume",
] as const

function region(path: string, startMarker: string, endMarker: string): string {
  const src = readFileSync(resolve(repo, path), "utf8")
  const start = src.indexOf(startMarker)
  expect(start, `${path}: marker ${JSON.stringify(startMarker)} not found`).toBeGreaterThan(-1)
  const end = src.indexOf(endMarker, start)
  expect(end, `${path}: end marker ${JSON.stringify(endMarker)} not found after start`).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe("voice-changer-pro ordered-voice shape — cross-surface parity", () => {
  const surfaces: Array<{ name: string; text: () => string }> = [
    {
      name: "MCP verb zod (lib/mcp/tools/verbs-audio.ts ordered_voices)",
      text: () => region(
        "backend/src/lib/mcp/tools/verbs-audio.ts",
        "ordered_voices: z",
        ".max(8)",
      ),
    },
    {
      name: "SDK type (packages/client VoiceChangerProVoice)",
      text: () => region(
        "packages/client/src/resources/voices.ts",
        "export type VoiceChangerProVoice",
        "/** Input for {@link VoicesResource.recast}. */",
      ),
    },
    {
      name: "frontend node data (types/nodes.ts VoiceChangerProData.orderedVoices)",
      text: () => region(
        "frontend/src/types/nodes.ts",
        "export type VoiceChangerProData",
        "generatedResults",
      ),
    },
    {
      name: "frontend api client (lib/api.ts voiceChangerProApi ordered voices)",
      text: () => region(
        "frontend/src/lib/api.ts",
        "export async function voiceChangerProApi",
        "return apiJson(\"/v1/voice-changer-pro\"",
      ),
    },
    {
      name: "node-registry descriptor comment (lib/node-registry.ts)",
      text: () => region(
        "backend/src/lib/node-registry.ts",
        "type: \"voice-changer-pro\"",
        "{ key: \"orderedVoices\"",
      ),
    },
  ]

  for (const surface of surfaces) {
    it(`${surface.name} names every canonical ordered-voice key`, () => {
      const text = surface.text()
      const missing = CANONICAL_KEYS.filter((k) => !text.includes(k))
      expect(
        missing,
        `missing ordered-voice keys — update this surface to match the plugin's recastVoice zod (the wire authority)`,
      ).toEqual([])
    })
  }
})
