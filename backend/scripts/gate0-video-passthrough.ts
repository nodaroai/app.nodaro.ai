// backend/scripts/gate0-video-passthrough.ts
// Gate 0: prove Gemini-via-KIE genuinely ingests video + audio, at window scale
// and combined with response_format. NOTE (live-verified 2026-07-03): KIE's
// chat-completions proxy SILENTLY DROPS `video_url`/`audio_url` parts and forwards
// ONLY `image_url`; Gemini then ingests the underlying media by MIME (mp4 =
// frames + audio track, mp3 = audio). llm-client maps our {type:"video"|"audio"}
// blocks to `image_url` accordingly, so this harness exercises the REAL production
// transport (not the dropped-on-the-floor video_url path).
// Usage: npx tsx scripts/gate0-video-passthrough.ts <shortUrl> <windowUrl> <fullUrl>
import { z } from "zod"
import { llmComplete, llmCompleteStructured } from "../src/lib/llm-client.js"

const [shortUrl, windowUrl, fullUrl] = process.argv.slice(2)
if (!shortUrl || !windowUrl || !fullUrl) {
  console.error("usage: gate0-video-passthrough.ts <10s-mp4-url> <150s-1080p-mp4-url> <600s-mp4-url>")
  process.exit(1)
}
const probeSchema = z.object({
  sawFrames: z.boolean(),
  heardAudio: z.boolean(),
  firstSpokenWords: z.string(),
  visualSummary: z.string(),
})
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    const r = await fn()
    console.log(`[gate0] ${label}: PASS in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    return r
  } catch (err) {
    console.error(`[gate0] ${label}: FAIL in ${((Date.now() - t0) / 1000).toFixed(1)}s`, err)
    throw err
  }
}
async function main() {
  // Test 1 — short clip, plain llmComplete (frames AND audio must be proven)
  const t1 = await timed("test1-short-plain", () =>
    llmComplete({
      modelId: "gemini-3-flash",
      system: "You are verifying multimodal ingestion.",
      messages: [{ role: "user", content: [
        { type: "video", url: shortUrl },
        { type: "text", text: "Describe what happens, quote any speech verbatim, describe the music/sfx." },
      ] }],
      timeoutMs: 300_000,
    }))
  console.log("[gate0] test1 answer:\n", typeof t1 === "string" ? t1 : JSON.stringify(t1).slice(0, 2000))

  // Test 2 — window-scale file + response_format TOGETHER (the production combination)
  const t2 = await timed("test2-window-structured", () =>
    llmCompleteStructured(
      {
        modelId: "gemini-3-flash",
        system: "Verify multimodal ingestion. Answer honestly.",
        messages: [{ role: "user", content: [
          { type: "video", url: windowUrl },
          { type: "text", text: "Did you see frames? Did you hear audio? Quote the first spoken words." },
        ] }],
        timeoutMs: 300_000,
      },
      probeSchema,
      { maxRetries: 1 },
    ))
  console.log("[gate0] test2 structured:", JSON.stringify(t2))

  // Test 3 — full-scale (~600s) file: probes KIE URL-fetch size ceiling
  const t3 = await timed("test3-full-structured", () =>
    llmCompleteStructured(
      {
        modelId: "gemini-3-flash",
        system: "Verify multimodal ingestion. Answer honestly.",
        messages: [{ role: "user", content: [
          { type: "video", url: fullUrl },
          { type: "text", text: "Did you see frames? Did you hear audio? Summarize the last 30 seconds specifically." },
        ] }],
        timeoutMs: 300_000,
      },
      probeSchema,
      { maxRetries: 1 },
    ))
  console.log("[gate0] test3 structured:", JSON.stringify(t3))
}
main().then(() => process.exit(0)).catch(() => process.exit(1))
