import type { TranscribeProvider } from "@nodaro/shared/models"

/** The engine the MCP `transcribe` tool runs on. Typed against the ENABLED
 *  provider enum, so disabling this lane in @nodaro/shared fails the build here
 *  instead of 400ing every MCP transcribe call at the route. It is word-level,
 *  which is what makes `output_data.json.words` dependable for MCP callers.
 *  A leaf, so the UGC quote (ee/lib/ugc-quote.ts) prices a transcribe call on
 *  it without loading the audio verbs; verbs-audio.ts re-exports it. */
export const MCP_TRANSCRIBE_PROVIDER: TranscribeProvider = "elevenlabs-stt"
