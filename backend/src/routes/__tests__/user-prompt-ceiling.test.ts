import { describe, it, expect } from "vitest"
import { PROMPT_HARD_CEILING } from "@nodaro/shared"
import { generateVideoBody } from "../generate-video.js"
import { textToVideoBody } from "../text-to-video.js"
import { generateImageBody } from "../generate-image.js"
import { imageToImageBody } from "../image-to-image.js"
import { editImageBody } from "../edit-image.js"
import { extendVideoBody } from "../extend-video.js"
import { motionTransferBody } from "../motion-transfer.js"

// `userPrompt` is the frontend's raw-typed-text echo (jobs.input_data.userPrompt,
// set via setUserPromptTemplate() in frontend/src/lib/api.ts — "what the user
// typed" vs "what was sent to the AI"). It carries the SAME content as the
// route's primary `prompt` field, so its cap must never sit below it: a
// Seedance 2 prompt well under its real 20,000-char model cap and under
// PROMPT_HARD_CEILING was hard-rejected because `userPrompt` alone was still
// pinned at the old flat 8000 (bug: `prompt` was migrated to
// PROMPT_HARD_CEILING, `userPrompt` was not, in the same schema).
describe("userPrompt cap matches PROMPT_HARD_CEILING (not the old flat 8000)", () => {
  const schemas = [
    ["generate-video", generateVideoBody],
    ["text-to-video", textToVideoBody],
    ["generate-image", generateImageBody],
    ["image-to-image", imageToImageBody],
    ["edit-image", editImageBody],
    ["extend-video", extendVideoBody],
    ["motion-transfer", motionTransferBody],
  ] as const

  it.each(schemas)("%s: userPrompt accepts a 15,000-char value (old bug rejected past 8,000)", (_name, schema) => {
    const result = schema.shape.userPrompt.safeParse("a".repeat(15000))
    expect(result.success).toBe(true)
  })

  it.each(schemas)("%s: userPrompt cap is exactly PROMPT_HARD_CEILING", (_name, schema) => {
    const atCeiling = schema.shape.userPrompt.safeParse("a".repeat(PROMPT_HARD_CEILING))
    const overCeiling = schema.shape.userPrompt.safeParse("a".repeat(PROMPT_HARD_CEILING + 1))
    expect(atCeiling.success).toBe(true)
    expect(overCeiling.success).toBe(false)
  })
})
