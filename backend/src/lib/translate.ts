import Replicate from "replicate"
import { config } from "./config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export async function translateToEnglish(text: string): Promise<string> {
  const nonAsciiRatio = (text.match(/[^\x00-\x7F]/g) || []).length / text.length
  if (nonAsciiRatio < 0.1) {
    console.log("[translate] Already English, skipping")
    return text
  }

  console.log(`[translate] Translating: "${text}"`)

  const output = await replicate.run("meta/meta-llama-3.1-8b-instruct", {
    input: {
      system_prompt: "You are a translator. Output ONLY the English translation. No explanations, no notes, no quotes.",
      prompt: `Translate to English:\n${text}`,
      max_tokens: 500,
      temperature: 0.1,
    },
  })

  const translated = Array.isArray(output) ? output.join("") : String(output)
  const result = translated.trim()
  console.log(`[translate] Result: "${result}"`)
  return result
}
