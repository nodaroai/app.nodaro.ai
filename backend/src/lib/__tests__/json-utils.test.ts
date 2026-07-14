import { describe, it, expect } from "vitest"
import { extractJsonFromAIResponse, extractKieToolCallInput } from "@/lib/json-utils.js"

describe("extractKieToolCallInput", () => {
  // Verbatim wire shape from KIE /claude/v1/messages (live-captured 2026-07-14):
  // the tool call rides a TEXT block as a <tool_calls> pseudo-tag and the tool
  // object's closing brace is missing — malformed by construction.
  const kieTag = (input: string) =>
    `<tool_calls>[{"type":"tool_use","id":"toolu_01x","name":"segment_plan","input":${input}]</tool_calls>`

  it("extracts the input object from the malformed pseudo-tag", () => {
    const input = '{"globalStyle":"","segments":[{"prompt":"a man walks","duration":13}]}'
    expect(extractKieToolCallInput(kieTag(input))).toBe(input)
  })

  it("handles braces and escaped quotes inside string values", () => {
    const input = '{"prompt":"say \\"hi\\" and draw {curly} art","n":1}'
    expect(extractKieToolCallInput(kieTag(input))).toBe(input)
  })

  it("returns null when the input object is truncated (max_tokens)", () => {
    const truncated = '<tool_calls>[{"type":"tool_use","id":"t","name":"p","input":{"a":{"b":1}'
    expect(extractKieToolCallInput(truncated)).toBeNull()
  })

  it("returns null when there is no pseudo-tag", () => {
    expect(extractKieToolCallInput('{"input":{"a":1}}')).toBeNull()
  })

  it("returns null when the tag carries no input key", () => {
    expect(extractKieToolCallInput("<tool_calls>[]</tool_calls>")).toBeNull()
  })
})

describe("extractJsonFromAIResponse", () => {
  it("returns plain JSON object unchanged", () => {
    const input = '{"key": "value"}'
    expect(extractJsonFromAIResponse(input)).toBe('{"key": "value"}')
  })

  it("strips ```json fences", () => {
    const input = '```json\n{"key": "value"}\n```'
    expect(extractJsonFromAIResponse(input)).toBe('{"key": "value"}')
  })

  it("strips ``` fences without language tag", () => {
    const input = '```\n{"key": "value"}\n```'
    expect(extractJsonFromAIResponse(input)).toBe('{"key": "value"}')
  })

  it("extracts JSON object embedded in prose text", () => {
    const input = 'Here is the result:\n{"key": "value"}\nHope this helps!'
    expect(extractJsonFromAIResponse(input)).toBe('{"key": "value"}')
  })

  it("returns empty string for empty input", () => {
    expect(extractJsonFromAIResponse("")).toBe("")
  })

  it("returns original text when no JSON is found", () => {
    const input = "No JSON here at all"
    expect(extractJsonFromAIResponse(input)).toBe("No JSON here at all")
  })

  it("returns JSON array unchanged", () => {
    const input = '[{"a": 1}, {"b": 2}]'
    expect(extractJsonFromAIResponse(input)).toBe('[{"a": 1}, {"b": 2}]')
  })

  it("trims surrounding whitespace", () => {
    const input = '   {"key": "value"}   '
    expect(extractJsonFromAIResponse(input)).toBe('{"key": "value"}')
  })

  it("handles fences with trailing whitespace", () => {
    const input = '```json\n{"a": 1}\n```  '
    expect(extractJsonFromAIResponse(input)).toBe('{"a": 1}')
  })
})
