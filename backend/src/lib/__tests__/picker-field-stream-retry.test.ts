/**
 * End to end through the REAL structured stream, the REAL analyzer schema and
 * the REAL field gate: the attempt that streams is not always the attempt that
 * answers. Here attempt 0 streams an adult's details and then fails
 * validation; the one-shot correction retry answers for a teenager, and the
 * route's `done` would carry that answer, floored. Nothing streamed from
 * attempt 0 may be a value the floor strips from it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { buildMultiPickerAnalyzerSpec, buildPickerAnalyzerSpec, getAdultOnlyIds } from "@nodaro/prompts"
import { fakeAnthropicStream } from "./fake-anthropic-stream.js"

const configMock = {
  KIE_API_KEY: "test-kie-key" as string | undefined,
  KIE_API_BASE_URL: "https://api.kie.ai",
  ANTHROPIC_API_KEY: "test-ant-key" as string | undefined,
  GEMINI_API_KEY: undefined as string | undefined,
  NODE_ENV: "test",
}
vi.mock("../config.js", () => ({ config: configMock }))

const anthropicCreate = vi.fn()
const anthropicStream = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate, stream: anthropicStream } }),
}))

const PERSON = buildPickerAnalyzerSpec("person")
const STYLING = buildPickerAnalyzerSpec("styling")
const ADULT_ONLY_IDS = getAdultOnlyIds()

function ids(spec: typeof PERSON, dimension: string): readonly string[] {
  return spec.dimensions.find((d) => d.dimension === dimension)?.entryIds ?? []
}
const adultOnly = (spec: typeof PERSON, dimension: string): string =>
  ids(spec, dimension).find((id) => ADULT_ONLY_IDS.has(id)) as string

beforeEach(() => {
  vi.resetModules()
  anthropicCreate.mockReset()
  anthropicStream.mockReset()
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch must not be called")))
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the field gate across a correction retry", () => {
  it("never streams an adult-only value, even when the retry's subject turns out to be a minor", async () => {
    const { llmStreamStructured } = await import("../llm-client.js")
    const { createPickerFieldStream } = await import("../picker-field-stream.js")
    const { schema, toolName } = buildMultiPickerAnalyzerSpec(["person", "styling"])

    const hair = ids(PERSON, "hair-color").slice(0, 3) // one over the dimension's cap: fails validation
    const attempt0 = {
      person: { age: "age-early-20s", bust: adultOnly(PERSON, "bust"), "hair-color": hair },
      styling: { top: adultOnly(STYLING, "top") },
    }
    const attempt1 = { person: { age: "age-late-teen", "hair-color": [hair[0]] }, styling: {} }
    const text = JSON.stringify(attempt0)
    const fragments = text.match(/.{1,7}/g) ?? []
    anthropicStream.mockReturnValue(fakeAnthropicStream({ fragments }))
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", id: "tu_2", name: toolName, input: attempt1 }],
      usage: { input_tokens: 900, output_tokens: 80 },
      stop_reason: "tool_use",
    })

    const events: Array<{ field: string; value: string | string[] }> = []
    const fields = createPickerFieldStream({ targetPickers: ["person", "styling"], onField: (e) => events.push(e) })
    const res = await llmStreamStructured(
      { modelId: "claude-sonnet-4.6", system: "sys", messages: [{ role: "user", content: "analyze" }] },
      schema,
      { schemaName: toolName, onToolJson: (partialJson) => fields.push(partialJson) },
    )

    // The retry really answered, for a minor.
    expect(anthropicCreate).toHaveBeenCalledTimes(1)
    expect((res.output as { person: { age: string } }).person.age).toBe("age-late-teen")
    // Attempt 0 did stream; none of it was a value the floor removes.
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      for (const id of [e.value].flat()) expect(ADULT_ONLY_IDS.has(id), `${e.field}=${id}`).toBe(false)
    }
  })
})
