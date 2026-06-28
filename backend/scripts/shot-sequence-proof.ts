/**
 * Phase 0 keystone proof — MANUAL, not CI. Drives the 4 REST routes end-to-end:
 *   generate speech → forced alignment → resolve → render
 * then asserts each cue matched a real span (not a fallback) and that
 * re-rendering the SAME plan yields identical decoded frames.
 *
 * Prerequisites:
 *   - Backend running and reachable at BASE_URL (default http://localhost:8080)
 *   - video-generation and render workers running
 *   - Redis running
 *   - ELEVENLABS_API_KEY set in the environment
 *   - Cloudflare R2 configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)
 *   - First-render Remotion bundle already built (see render-worker.ts warm-up)
 *   - PROOF_USER_ID set to a real user UUID with sufficient credits
 *   - ffmpeg installed and on PATH (used to decode frames for the determinism assertion)
 *
 * Run: cd backend && \
 *   BASE_URL=http://localhost:8080 PROOF_USER_ID=<uuid> \
 *   npx tsx scripts/shot-sequence-proof.ts
 */
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeFile, unlink } from "node:fs/promises"
import { spawn } from "node:child_process"
import { config } from "../src/lib/config.js"
import { supabase } from "../src/lib/supabase.js"

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080"
const USER_ID = process.env.PROOF_USER_ID
if (!USER_ID) throw new Error("Set PROOF_USER_ID to a real user uuid with credits.")

const HEADERS = {
  "content-type": "application/json",
  "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers: HEADERS, body: JSON.stringify({ ...body, userId: USER_ID }) })
  const text = await res.text()
  if (res.status >= 400) throw new Error(`POST ${path} → ${res.status}: ${text}`)
  return JSON.parse(text) as Record<string, unknown>
}

async function pollJob(jobId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 240; i++) {
    const { data, error } = await supabase.from("jobs").select("status, output_data, error").eq("id", jobId).single()
    if (error) throw new Error(`poll ${jobId}: ${error.message}`)
    if (data.status === "completed") return (data.output_data ?? {}) as Record<string, unknown>
    if (data.status === "failed") throw new Error(`job ${jobId} FAILED: ${JSON.stringify(data.error)}`)
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`job ${jobId} did not complete in time`)
}

const SCRIPT =
  "Ship faster. Nodaro turns your idea into a finished video. " +
  "No timeline. No keyframes. Just describe it, and watch it appear."

// 2 scenes whose cue spans do NOT interleave (scene_hook early, scene_payoff late).
// rv_poster is a frame-0 reveal inside scene_hook (motion:none → opaque thumbnail);
// keeping it in the same scene as the hook avoids any inter-scene temporal overlap
// that could spuriously trip SceneOverlapError when the first cue lands at frame 0.
const validBrief = {
  fps: 30, width: 1920, height: 1080, backgroundColor: "#0b0b0f",
  narration: {
    script: SCRIPT,
    cues: [
      { id: "c_ship", text: "Ship faster" },
      { id: "c_idea", text: "your idea into a finished video" },
      { id: "c_describe", text: "describe it" },
      { id: "c_appear", text: "watch it appear" },
    ],
  },
  scenes: [
    {
      id: "scene_hook",
      shots: [{ id: "sh_hook", reveals: [
        // frame-0 poster: visible from the very first frame (opaque thumbnail)
        { id: "rv_poster", element: { id: "logo", type: "text", text: "NODARO", fontFamily: "Anton", fontSize: 90, color: "#7c5cff", x: 820, y: 60 }, revealAt: { kind: "frame", frame: 0 }, enter: { motion: "none", durationFrames: 0 } },
        { id: "rv_ship", element: { id: "t_ship", type: "text", text: "Ship faster", fontFamily: "Inter", fontSize: 130, fontWeight: 900, color: "#ffffff", x: 200, y: 440 }, revealAt: { kind: "cue", cueId: "c_ship", edge: "start" }, enter: { motion: "slide-up", durationFrames: 12, easing: "easeOut" }, hold: 20, exit: { motion: "fade", durationFrames: 10 } },
        { id: "rv_idea", element: { id: "t_idea", type: "text", text: "your idea → finished video", fontFamily: "Inter", fontSize: 70, color: "#b9b9c9", x: 200, y: 620 }, revealAt: { kind: "cue", cueId: "c_idea", edge: "start" }, enter: { motion: "fade", durationFrames: 10 } },
      ] }],
    },
    {
      id: "scene_payoff",
      shots: [{ id: "sh_payoff", reveals: [
        { id: "rv_describe", element: { id: "t_describe", type: "text", text: "Describe it.", fontFamily: "Inter", fontSize: 110, fontWeight: 900, color: "#ffffff", x: 200, y: 440 }, revealAt: { kind: "cue", cueId: "c_describe", edge: "start" }, enter: { motion: "scale-up", durationFrames: 12 } },
        { id: "rv_appear", element: { id: "t_appear", type: "text", text: "Watch it appear.", fontFamily: "Inter", fontSize: 110, fontWeight: 900, color: "#7c5cff", x: 200, y: 600 }, revealAt: { kind: "cue", cueId: "c_appear", edge: "end" }, enter: { motion: "wipe-in", durationFrames: 14, direction: "left" } },
      ] }],
    },
  ],
}

/**
 * Download an MP4, decode every frame to raw RGB24 via ffmpeg, and sha256 the
 * raw pixel bytes. The container byte-layout is codec-implementation-dependent
 * and can differ across re-encodes even when the visual content is identical;
 * the decoded frames are the actual determinism invariant.
 */
async function downloadDecodedFrameHash(url: string): Promise<string> {
  const res = await fetch(url)
  const buf = Buffer.from(await res.arrayBuffer())
  const tmpFile = join(tmpdir(), `proof-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`)
  await writeFile(tmpFile, buf)
  try {
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      const ffmpeg = spawn("ffmpeg", ["-i", tmpFile, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], {
        stdio: ["ignore", "pipe", "pipe"],
      })
      ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
      ffmpeg.on("error", (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)))
      ffmpeg.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}`))
          return
        }
        const raw = Buffer.concat(chunks)
        resolve(createHash("sha256").update(raw).digest("hex"))
      })
    })
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

async function main() {
  console.log("1) generate speech…")
  const tts = await post("/v1/text-to-speech", { text: SCRIPT })
  const ttsOut = await pollJob(String(tts.jobId))
  const audioUrl = String(ttsOut.audioUrl)
  console.log("   audio:", audioUrl)

  console.log("2) forced alignment…")
  const fa = await post("/v1/forced-alignment", { audioUrl, transcript: SCRIPT })
  const faOut = await pollJob(String(fa.jobId))
  const alignment = faOut.alignment as Array<{ word: string; start: number; end: number }>
  if (!alignment?.length) throw new Error("alignment empty — keystone cannot be proven")
  console.log(`   ${alignment.length} words aligned`)

  console.log("3) resolve…")
  const resolved = await post("/v1/shot-sequence/resolve", { brief: validBrief, audioUrl, alignment })
  const warnings = resolved.warnings as string[]
  if (warnings.length > 0) throw new Error(`KEYSTONE NOT PROVEN — cues fell back instead of matching real spans: ${warnings.join("; ")}`)
  console.log("   all cues matched real word spans ✓")
  const plan = resolved.plan as Record<string, unknown>

  console.log("4) render…")
  const r1 = await post("/v1/render-video/plan", { planType: "shot-sequence", plan })
  const r1Out = await pollJob(String(r1.jobId))
  const video1 = String(r1Out.videoUrl)
  console.log("   MP4:", video1)

  console.log("5) determinism — re-render the SAME plan…")
  const r2 = await post("/v1/render-video/plan", { planType: "shot-sequence", plan })
  const r2Out = await pollJob(String(r2.jobId))
  const [h1, h2] = await Promise.all([downloadDecodedFrameHash(video1), downloadDecodedFrameHash(String(r2Out.videoUrl))])
  if (h1 !== h2) throw new Error(`DETERMINISM FAILED — decoded frames differ across re-render (${h1.slice(0, 8)} vs ${h2.slice(0, 8)})`)
  console.log("   decoded-frame hashes match — deterministic ✓")

  console.log("6) overlap guard — an interleaved brief must be REJECTED…")
  const interleaved = JSON.parse(JSON.stringify(validBrief))
  // Move the payoff scene's first reveal to a cue inside the hook scene's span.
  interleaved.scenes[2].shots[0].reveals[0].revealAt = { kind: "cue", cueId: "c_ship", edge: "start" }
  const res = await fetch(`${BASE_URL}/v1/shot-sequence/resolve`, { method: "POST", headers: HEADERS, body: JSON.stringify({ brief: interleaved, audioUrl, alignment, userId: USER_ID }) })
  if (res.status !== 422) throw new Error(`expected 422 scene_overlap, got ${res.status}`)
  console.log("   interleaved brief rejected (422) ✓")

  console.log("\n✅ KEYSTONE PROVEN: VO-paced reveals render, deterministically; overlap guarded.")
}

main().then(() => process.exit(0)).catch((e) => { console.error("❌", e); process.exit(1) })
