import { replicate } from "../providers/replicate/client.js"

export async function translateToEnglish(text: string): Promise<string> {
  const nonAsciiRatio = (text.match(/[^\x00-\x7F]/g) || []).length / text.length
  if (nonAsciiRatio < 0.1) {
    return text
  }

  console.log(`[translate] Input: "${text}"`)

  const output = await replicate.run("google/gemini-2.5-flash", {
    input: {
      prompt: `You are a creative translator for AI image generation prompts.

Translate the following text to English. Make it descriptive and suitable for image generation.
Keep the meaning but enhance it with visual details that will help an AI create a better image.

Text to translate:
${text}

Output only the English translation, nothing else.`,
      max_tokens: 500,
    },
  })

  const result = Array.isArray(output) ? output.join("") : String(output)
  console.log(`[translate] Output: "${result}"`)
  return result.trim()
}
