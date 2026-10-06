import { describe, it, expect, vi } from "vitest"
import { createClient, StaticTokenAuth } from "../index.js"
// WIRE-01: every type in a public method signature is re-exported from @nodaro/sdk.
import type { TextToSpeechParams } from "../index.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

/** The JSON body of the most recent request. */
function sentBody(calls: readonly unknown[][]): Record<string, unknown> {
  const init = calls.at(-1)![1] as { body: string }
  return JSON.parse(init.body) as Record<string, unknown>
}

it("types the text-to-speech params, neighbour text included (compiles only if the type exists and carries the fields)", () => {
  const params: TextToSpeechParams = {
    text: "And so it begins.",
    provider: "elevenlabs-v4",
    voice: "Rachel",
    previousText: "The night before, nobody slept.",
    nextText: "By noon the harbour was empty.",
  }
  expect(params.previousText).toContain("nobody slept")
})

describe("nodes.run(\"text-to-speech\") — neighbour text", () => {
  it("posts previousText / nextText under their own names (vitest does not typecheck; this pins serialisation)", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ jobId: "j-tts" }))
    const c = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })
    await c.nodes.run("text-to-speech", { text: "Middle.", provider: "elevenlabs-v4", previousText: "Before.", nextText: "After." })
    expect(sentBody(fetchMock.mock.calls)).toMatchObject({ text: "Middle.", provider: "elevenlabs-v4", previousText: "Before.", nextText: "After." })
  })
})
