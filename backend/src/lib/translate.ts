import { llmComplete } from "./llm-client.js"
import { LLM_FEATURE_DEFAULTS } from "../../../packages/shared/src/llm-models.js"

export async function translateToEnglish(text: string): Promise<string> {
  const nonAsciiRatio = (text.match(/[^\x00-\x7F]/g) || []).length / text.length
  if (nonAsciiRatio < 0.1) {
    return text
  }

  console.log(`[translate] Input: "${text}"`)

  const response = await llmComplete({
    modelId: LLM_FEATURE_DEFAULTS["translate"],
    system: "You are a creative translator for AI image generation prompts. Output only the English translation, nothing else.",
    messages: [{
      role: "user",
      content: `Translate the following text to English. Make it descriptive and suitable for image generation. Keep the meaning but enhance it with visual details that will help an AI create a better image.\n\nText to translate:\n${text}`,
    }],
    maxTokens: 500,
  })

  const result = response.text.trim()
  console.log(`[translate] Output: "${result}"`)
  return result
}
