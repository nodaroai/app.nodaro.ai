import { describe, it, expect } from "vitest"
import { extractJsonFromAIResponse } from "@/lib/json-utils.js"

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
