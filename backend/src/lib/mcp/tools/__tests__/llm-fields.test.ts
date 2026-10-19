/**
 * Every MCP tool that fronts an LLM route must expose that route's LLM knobs.
 *
 * It didn't. `image_to_text` shipped with no model selector at all, so MCP
 * callers were pinned to the feature default with no way to reach a stronger
 * vision model — while `prompt-helper.ts` carried three hand-copied duplicates
 * of the same advanced-mode fields. `LLM_MCP_FIELDS` is the single declaration;
 * this pins that the tools actually spread it, and that the args mapping is
 * omission-correct (a field the caller didn't send must not reach the route as
 * an explicit `undefined`).
 */
import { describe, it, expect } from "vitest"
import { z } from "zod"
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { LLM_MCP_FIELDS, llmPayloadFields } from "../_llm-fields.js"

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url)).replace(/__tests__$/, "")

/** Files whose tools front an LLM route. Add a row when a new one lands. */
const LLM_TOOL_FILES = ["prompt-helper.ts", "verbs-image.ts"]

describe("LLM_MCP_FIELDS", () => {
  it("declares the full knob set the LLM routes accept", () => {
    expect(Object.keys(LLM_MCP_FIELDS).sort()).toEqual([
      "advanced_mode",
      "llmModel",
      "max_tokens",
      "reasoning_effort",
      "temperature",
    ])
  })

  it("is spread by every LLM-backed tool file rather than hand-copied", () => {
    for (const file of LLM_TOOL_FILES) {
      const src = readFileSync(join(TOOLS_DIR, file), "utf8")
      expect(src, `${file} must spread LLM_MCP_FIELDS`).toContain("...LLM_MCP_FIELDS")
      // A hand-rolled copy would drift the moment the routes gain a knob.
      expect(src, `${file} re-declares advanced_mode instead of spreading`).not.toMatch(
        /^\s*advanced_mode:\s*z\./m,
      )
    }
  })
})

describe("LLM_MCP_FIELDS.llmModel and retired models", () => {
  it("accepts a retired id (saved callers keep working) but does not advertise it", () => {
    const schema = z.object(LLM_MCP_FIELDS)
    expect(schema.safeParse({ llmModel: "gemini-3.7-flash" }).success).toBe(true)
    expect(schema.safeParse({ llmModel: "gemini-3.8-flash" }).success).toBe(true)
    expect(schema.safeParse({ llmModel: "not-a-model" }).success).toBe(false)
    // The converter the MCP server lists tools through, so this is what clients see.
    const listed = toJsonSchemaCompat(schema) as { properties?: Record<string, { enum?: string[] }> }
    const advertised = listed.properties?.llmModel?.enum
    expect(advertised).toContain("gemini-3.8-flash")
    expect(advertised).not.toContain("gemini-3.7-flash")
  })
})

describe("llmPayloadFields", () => {
  it("maps snake_case MCP args onto the camelCase route body", () => {
    expect(
      llmPayloadFields({
        llmModel: "gemini-3.1-pro",
        reasoning_effort: "high",
        advanced_mode: true,
        temperature: 1.2,
        max_tokens: 4096,
      }),
    ).toEqual({
      llmModel: "gemini-3.1-pro",
      reasoningEffort: "high",
      advancedMode: true,
      temperature: 1.2,
      maxTokens: 4096,
    })
  })

  it("omits absent fields entirely — no explicit undefined on the wire", () => {
    expect(llmPayloadFields({})).toEqual({})
  })

  it("never sends advancedMode: false", () => {
    // `false` would still be a value the route parses; omission keeps an
    // untouched request byte-identical to a pre-feature one.
    expect(llmPayloadFields({ advanced_mode: false })).toEqual({})
  })

  it("passes temperature 0 through — it is a value, not a missing one", () => {
    expect(llmPayloadFields({ temperature: 0 })).toEqual({ temperature: 0 })
  })
})
