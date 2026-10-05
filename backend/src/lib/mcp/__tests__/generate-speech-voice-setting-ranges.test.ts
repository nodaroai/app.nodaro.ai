import { describe, it, expect } from "vitest"
import { z } from "zod"
import { captureMcpToolSchemas } from "../../../../scripts/lib/gen-skills/capture-mcp-schemas.js"
import { ALL_SCOPES } from "../../scopes.js"
import { TTS_VOICE_SETTING_RANGES, type TtsVoiceSettingKey } from "../../../providers/elevenlabs/voice-settings.js"

/**
 * MCP `generate_speech` declares the four voice-setting ranges in its own input
 * schema, while the REST route and the provider funnel read
 * `TTS_VOICE_SETTING_RANGES`. This reads the bounds from the REGISTERED tool's
 * JSON Schema (the same conversion the published tool-parameters doc uses) and
 * fails the moment the two disagree — so an agent is never refused a value the
 * platform accepts, or offered one it clamps.
 */
const MCP_PARAM_FOR: Readonly<Record<TtsVoiceSettingKey, string>> = {
  stability: "stability",
  similarityBoost: "similarity_boost",
  style: "style",
  speed: "speed",
}

describe("MCP generate_speech voice-setting ranges", () => {
  // Builds the full MCP server: give it the headroom the other capture tests use.
  it("match TTS_VOICE_SETTING_RANGES, setting by setting", { timeout: 20_000 }, async () => {
    const tools = await captureMcpToolSchemas(ALL_SCOPES)
    const tool = tools.find((t) => t.name === "generate_speech")
    expect(tool, "generate_speech is registered").toBeDefined()
    const json = z.toJSONSchema(z.object(tool!.inputSchema as z.ZodRawShape), {
      io: "input",
      unrepresentable: "any",
    }) as { properties: Record<string, { type?: string; minimum?: number; maximum?: number }> }

    const declared = Object.fromEntries(
      (Object.keys(MCP_PARAM_FOR) as TtsVoiceSettingKey[]).map((key) => {
        const prop = json.properties[MCP_PARAM_FOR[key]]
        expect(prop, `generate_speech declares ${MCP_PARAM_FOR[key]}`).toBeDefined()
        expect(prop!.type).toBe("number")
        return [key, { min: prop!.minimum, max: prop!.maximum }]
      }),
    )
    expect(declared).toEqual(TTS_VOICE_SETTING_RANGES)
  })

  it("covers every voice setting the funnel knows", () => {
    expect(Object.keys(MCP_PARAM_FOR).sort()).toEqual(Object.keys(TTS_VOICE_SETTING_RANGES).sort())
  })
})
