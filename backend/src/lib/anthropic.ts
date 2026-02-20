import Anthropic from "@anthropic-ai/sdk"
import { config } from "./config.js"

export const CLAUDE_MODEL = "claude-sonnet-4-5-20250929"

let _client: Anthropic | null = null
export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  }
  return _client
}
