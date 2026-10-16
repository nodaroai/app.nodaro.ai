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

  // KIE's Claude prompt-JSON answers (kieClaudePromptJson) sometimes add a
  // sentence after the fence, or braces in the prose around the object.
  it("takes the fenced block when prose follows the fence", () => {
    expect(extractJsonFromAIResponse('```json\n{"a": 1}\n```\nLet me know if you need {more} detail.')).toBe('{"a": 1}')
  })

  it("takes a fenced block that prose precedes", () => {
    expect(extractJsonFromAIResponse('Here it is:\n```json\n{"a": {"b": "}"}}\n```')).toBe('{"a": {"b": "}"}}')
  })

  it("drops trailing prose, braces included, after a bare object", () => {
    expect(extractJsonFromAIResponse('{"a": [1, {"b": 2}]}\n\nNote: {x} is approximate.')).toBe('{"a": [1, {"b": 2}]}')
  })

  it("skips braces in leading prose and takes the first object that parses", () => {
    expect(extractJsonFromAIResponse('The {subject} reads as: {"age": "age-30s"} — done.')).toBe('{"age": "age-30s"}')
  })

  // A JSON answer may CARRY a markdown code block inside a string value; that
  // fence is content, never a wrapper (regressed once: the answer was cut to
  // the inside of the block).
  const withCodeBlock = { title: "x", body: "Example:\n```js\nconsole.log(1)\n```\nend" }

  it("keeps compact JSON whose string value holds a fenced code block", () => {
    const json = JSON.stringify(withCodeBlock)
    expect(JSON.parse(extractJsonFromAIResponse(json))).toEqual(withCodeBlock)
  })

  it("keeps pretty-printed JSON whose string value holds a fenced code block", () => {
    const json = JSON.stringify(withCodeBlock, null, 2)
    expect(JSON.parse(extractJsonFromAIResponse(json))).toEqual(withCodeBlock)
  })

  it("unwraps a json fence around such JSON, with prose before and after", () => {
    const raw = `Here you go:\n\`\`\`json\n${JSON.stringify(withCodeBlock)}\n\`\`\`\nHope that helps.`
    expect(JSON.parse(extractJsonFromAIResponse(raw))).toEqual(withCodeBlock)
  })

  it("keeps a fenced ARRAY whose strings carry ``` pairs an array", () => {
    const raw = '```json\n[1,{"a":"b```c```"},"]"]\n```'
    expect(JSON.parse(extractJsonFromAIResponse(raw))).toEqual([1, { a: "b```c```" }, "]"])
  })

  it("strips an opening fence that never closes, leaving the cut-off JSON", () => {
    expect(extractJsonFromAIResponse('```json\n{"a": [1, 2')).toBe('{"a": [1, 2')
  })

  it("leaves a truncated object as it stands, so the parse error names it", () => {
    expect(extractJsonFromAIResponse('{"a": [1, 2')).toBe('{"a": [1, 2')
  })

  it("handles fences with trailing whitespace", () => {
    const input = '```json\n{"a": 1}\n```  '
    expect(extractJsonFromAIResponse(input)).toBe('{"a": 1}')
  })
})
