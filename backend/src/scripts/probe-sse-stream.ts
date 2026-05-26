/**
 * End-to-end verification probe — subscribes to a pipeline's SSE event
 * stream and logs every frame with type + timestamp + latency.
 *
 * Use this AFTER deploying the cross-process bridge to confirm that
 * events published by the pipeline-worker process (Showrunner stream,
 * entity transitions, etc.) actually reach the API server's SSE
 * subscribers. If stage:progress events show up here for a running
 * pipeline, the bridge works end-to-end.
 *
 * Usage:
 *   PROBE_BASE_URL=https://next.nodaro.ai \
 *   PROBE_SUPABASE_TOKEN=<your supabase access token> \
 *   npx tsx src/scripts/probe-sse-stream.ts <pipelineId>
 *
 * Get a Supabase token by opening DevTools on next.nodaro.ai →
 * Application → Local Storage → look for `sb-*-auth-token`. The JWT is
 * inside the `access_token` field of the JSON value.
 */
import { config } from "../lib/config.js"

const pipelineId = process.argv[2]
if (!pipelineId) {
  console.error("usage: probe-sse-stream.ts <pipelineId>")
  console.error("env: PROBE_BASE_URL=https://next.nodaro.ai PROBE_SUPABASE_TOKEN=<jwt>")
  process.exit(1)
}

const base = process.env.PROBE_BASE_URL ?? `http://localhost:${config.PORT || 8000}`
const token = process.env.PROBE_SUPABASE_TOKEN
if (!token) {
  console.error("Set PROBE_SUPABASE_TOKEN to your Supabase access token.")
  process.exit(1)
}

const url = `${base}/v1/pipelines/${pipelineId}/events`

console.log(`[sse-probe] Connecting to ${url}`)
console.log("[sse-probe] Subscribe → wait → trigger Stage 1 → watch for stage:progress frames")
console.log("")

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
})

if (!res.ok || !res.body) {
  console.error(`[sse-probe] HTTP ${res.status} ${res.statusText}`)
  console.error(await res.text())
  process.exit(1)
}

console.log(`[sse-probe] Connected (HTTP ${res.status}). Streaming…\n`)

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ""
let frameNum = 0
const counts: Record<string, number> = {}

const summaryInterval = setInterval(() => {
  if (Object.keys(counts).length === 0) {
    console.log(`[${new Date().toISOString()}] (idle — no events yet)`)
    return
  }
  const summary = Object.entries(counts)
    .map(([t, n]) => `${t}=${n}`)
    .join(" ")
  console.log(`[${new Date().toISOString()}] running totals: ${summary}`)
}, 10_000)

try {
  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      console.log("[sse-probe] stream closed by server")
      break
    }
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      frameNum++
      const dataLines = frame.split("\n").filter((l) => l.startsWith("data: "))
      if (dataLines.length === 0) continue
      const json = dataLines.map((l) => l.slice(6)).join("\n")
      try {
        const parsed = JSON.parse(json)
        const evt = parsed.data ?? parsed
        const t = evt.type ?? parsed.type ?? "?"
        counts[t] = (counts[t] ?? 0) + 1
        const short = JSON.stringify(evt).slice(0, 220)
        console.log(`[${new Date().toISOString()}] frame#${frameNum} ${t}: ${short}`)
      } catch {
        console.log(`[${new Date().toISOString()}] frame#${frameNum} (parse-fail): ${json.slice(0, 200)}`)
      }
    }
  }
} finally {
  clearInterval(summaryInterval)
}
