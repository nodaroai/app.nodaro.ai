import { describe, it, expect } from "vitest"
import { DEFAULT_TEXT_TO_AUDIO_PROVIDER, TEXT_TO_AUDIO_PROVIDERS } from "@nodaro/shared"
import { NODE_DEFINITIONS } from "../nodes"

// The Text to Audio node's default engine must equal the shared constant the
// route, worker and orchestrator read — a new node must start on the engine
// the backend will actually run and bill. (NODE_DEFINITIONS keeps a literal
// because the gen:skills parser reads it statically; this test is the link.)
describe("Text to Audio default engine", () => {
  it("is ElevenLabs sound effects, and an offered engine", () => {
    expect(DEFAULT_TEXT_TO_AUDIO_PROVIDER).toBe("elevenlabs-sfx")
    expect(TEXT_TO_AUDIO_PROVIDERS).toContain(DEFAULT_TEXT_TO_AUDIO_PROVIDER)
  })

  it("a freshly added node carries it", () => {
    const def = NODE_DEFINITIONS.find((d) => d.type === "text-to-audio")
    expect(def?.defaultData).toMatchObject({ provider: DEFAULT_TEXT_TO_AUDIO_PROVIDER })
  })
})
