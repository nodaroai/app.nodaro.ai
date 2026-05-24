import { describe, it, expect } from "vitest"
import { default as zodToJsonSchema } from "zod-to-json-schema"
import { ChatTurnResponseSchema, STAGE_PATCH_SCHEMA } from "../pipeline-chat.js"
import { PIPELINE_STAGE_NAMES } from "../pipeline-events.js"

describe("ChatTurnResponseSchema", () => {
  it("parses an edit_artifact response", () => {
    const result = ChatTurnResponseSchema.safeParse({
      reply: "I'll change the title.",
      proposed_change: {
        change_type: "edit_artifact",
        json_patch: [{ op: "replace", path: "/title", value: "New Title" }],
        summary: "Update title",
      },
    })
    expect(result.success).toBe(true)
  })

  it("parses a suggest_branch response", () => {
    const result = ChatTurnResponseSchema.safeParse({
      reply: "This needs a deeper restructure.",
      proposed_change: {
        change_type: "suggest_branch",
        from_stage: "script",
        reason: "Restructuring scenes changes too many dependent shots",
      },
    })
    expect(result.success).toBe(true)
  })

  it("parses a chat-only reply with proposed_change: null", () => {
    const result = ChatTurnResponseSchema.safeParse({
      reply: "What would you like to change?",
      proposed_change: null,
    })
    expect(result.success).toBe(true)
  })

  it("rejects edit_artifact with empty json_patch", () => {
    const result = ChatTurnResponseSchema.safeParse({
      reply: "Foo",
      proposed_change: {
        change_type: "edit_artifact",
        json_patch: [],
        summary: "Summary",
      },
    })
    expect(result.success).toBe(false)
  })

  it("rejects edit_artifact with > 50 json_patch ops", () => {
    const result = ChatTurnResponseSchema.safeParse({
      reply: "Foo",
      proposed_change: {
        change_type: "edit_artifact",
        json_patch: new Array(51).fill({ op: "replace", path: "/x", value: 1 }),
        summary: "Summary",
      },
    })
    expect(result.success).toBe(false)
  })

  it("produces JSON Schema with root type:object (Anthropic-valid)", () => {
    const js = zodToJsonSchema(ChatTurnResponseSchema, { target: "jsonSchema7" })
    expect((js as { type?: string }).type).toBe("object")
  })

  it("rejects from_stage='post_merge' for suggest_branch (branching back to itself is a no-op re-merge)", () => {
    const result = ChatTurnResponseSchema.safeParse({
      reply: "test",
      proposed_change: {
        change_type: "suggest_branch",
        from_stage: "post_merge",
        reason: "test",
      },
    })
    expect(result.success).toBe(false)
  })

  it("accepts from_stage='characters' for suggest_branch (covers the widened enum)", () => {
    const result = ChatTurnResponseSchema.safeParse({
      reply: "Cast tweaks needed.",
      proposed_change: {
        change_type: "suggest_branch",
        from_stage: "characters",
        reason: "Re-cast the protagonist to a different age range.",
      },
    })
    expect(result.success).toBe(true)
  })
})

describe("STAGE_PATCH_SCHEMA", () => {
  it("has an entry for every PIPELINE_STAGE_NAMES value", () => {
    for (const stage of PIPELINE_STAGE_NAMES) {
      expect(STAGE_PATCH_SCHEMA[stage]).toBeDefined()
    }
  })

  it("only 'script' has a non-null schema in 1D.2b", () => {
    expect(STAGE_PATCH_SCHEMA.script).not.toBeNull()
    expect(STAGE_PATCH_SCHEMA.characters).toBeNull()
    expect(STAGE_PATCH_SCHEMA.objects).toBeNull()
    expect(STAGE_PATCH_SCHEMA.locations).toBeNull()
    expect(STAGE_PATCH_SCHEMA.shot_list).toBeNull()
    expect(STAGE_PATCH_SCHEMA.scene_images).toBeNull()
    expect(STAGE_PATCH_SCHEMA.animate_audio_edit).toBeNull()
    expect(STAGE_PATCH_SCHEMA.post_merge).toBeNull()
  })
})
