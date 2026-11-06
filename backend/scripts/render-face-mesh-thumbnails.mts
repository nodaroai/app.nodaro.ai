/**
 * Renders the face mesh illustrations of Admin → Nodaro Motion (the "Face mesh
 * lines" choices and the layer switches): one depth face per set of layers
 * that draws lines (the 62 sets of `VIDEO_FACE_MESH_LAYERS` with a layer other
 * than bold on), plus the depth face with no lines.
 *
 * Each one is drawn by the platform's own code, `drawFaceMeshVideo` (the core
 * of `POST /v1/video-face-mesh`): the faces are found in the source clip and
 * the lines drawn on its depth render, with the detector, the landmark model,
 * the tracking and smoothing, the visibility (contours) and the tones exactly
 * as a run draws them. To make the lines readable at thumbnail size, both
 * clips are first cut to a few frames around `--frame`, cropped square round
 * the face (`--crop`) and enlarged to `--size` px, so the face fills the frame
 * and the irises are clearly drawn; the picture kept is that one frame.
 * The irises are small even then, so they get one more: `irises-closeup`, the
 * irises alone drawn on the same crop enlarged further, so that the eyes' box
 * (`--eyes`, in the source clip's pixels, inside `--crop`) fills `--size`,
 * and cut to that box.
 *
 * Writes `<key>.<hash>.webp` into frontend/public/face-mesh-art/ (clearing
 * the old ones; the key names the layers on, `+`-joined in
 * `VIDEO_FACE_MESH_LAYERS` order, or `depth` for no lines) and their list,
 * frontend/src/ee/app/(admin)/admin/trends/face-mesh-thumbnail-files.ts.
 *
 * A manual tool, never run by CI or the build. Needs ffmpeg on the PATH and
 * `npm run build:packages`; nothing is contacted, but the backend's config
 * wants its three env vars set, so stubs do. Usage (from backend/):
 *   SUPABASE_URL=http://stub SUPABASE_SERVICE_ROLE_KEY=stub INTERNAL_ORCHESTRATOR_SECRET=<any 32+ chars> \
 *   npx tsx scripts/render-face-mesh-thumbnails.mts --source <clip> --depth <gray depth clip of it> \
 *     --frame <n> --crop <x>:<y>:<side> --eyes <x>:<y>:<side> [--size 256]
 * The shipped set: a 854×480 clip of a face turned a little from the camera,
 * `--frame 116 --crop 270:68:124 --eyes 322:82:56 --size 256`.
 */
// @reads-none reads only the clips named on its command line; it writes (and clears) its own output folder
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"
import { VIDEO_FACE_MESH_LAYERS, videoFaceMeshLayersDrawLines, type VideoFaceMeshLayers } from "@nodaro/shared/media"
import { drawFaceMeshVideo } from "../src/services/face-mesh/draw-face-mesh.js"

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const source = arg("--source")
const depth = arg("--depth")
const frame = Number(arg("--frame"))
const box = (name: string): [number, number, number] | null => {
  const v = (arg(name) ?? "").split(":").map(Number)
  return v.length === 3 && v.every((n) => Number.isFinite(n)) ? (v as [number, number, number]) : null
}
const crop = box("--crop")
const eyes = box("--eyes")
const size = Number(arg("--size") ?? 256)
if (!source || !depth || !Number.isInteger(frame) || !crop || !eyes || !(size > 0)) {
  throw new Error("usage: --source <clip> --depth <clip> --frame <n> --crop <x>:<y>:<side> --eyes <x>:<y>:<side> [--size 256]")
}
const [cx, cy, side] = crop

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const outDir = join(repo, "frontend/public/face-mesh-art")
const listPath = join(repo, "frontend/src/ee/app/(admin)/admin/trends/face-mesh-thumbnail-files.ts")
const work = mkdtempSync(join(tmpdir(), "face-mesh-thumbs-"))

// A few frames each side, so the tracker sees the face for long enough and the smoothing settles.
const AROUND = 15
const first = Math.max(0, frame - AROUND)
const kept = frame - first

/** The clip cut to `first … frame + AROUND`, cropped and enlarged to `px` (near-lossless, so the depth is not banded). */
function cut(path: string, name: string, px: number): string {
  const out = join(work, name)
  const vf = `select=between(n\\,${first}\\,${frame + AROUND}),setpts=N/FRAME_RATE/TB,crop=${side}:${side}:${cx}:${cy},scale=${px}:${px}:flags=lanczos`
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path, "-vf", vf, "-an", "-c:v", "libx264", "-crf", "1", "-pix_fmt", "yuv420p", out])
  return out
}

/** Frame `kept` of `clip` (cut to `region`, in its pixels, when given), as a WebP. */
async function still(clip: string, region?: { left: number; top: number; width: number; height: number }): Promise<Buffer> {
  const png = execFileSync("ffmpeg", ["-v", "error", "-i", clip, "-vf", `select=eq(n\\,${kept})`, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { maxBuffer: 1e8 })
  return (region ? sharp(png).extract(region) : sharp(png)).webp({ quality: 65, effort: 6 }).toBuffer()
}

const FILTERS = { minFaceHeightPct: 0, maxFaceHeightPct: 0, zone: null }
const src = cut(source, "source.mp4", size)
const dep = cut(depth, "depth.mp4", size)

const sets: Array<{ key: string; layers: VideoFaceMeshLayers | null }> = [{ key: "depth", layers: null }]
for (let mask = 1; mask < 1 << VIDEO_FACE_MESH_LAYERS.length; mask++) {
  const on = VIDEO_FACE_MESH_LAYERS.filter((_, i) => mask & (1 << i))
  const layers = Object.fromEntries(on.map((l) => [l, true])) as VideoFaceMeshLayers
  if (videoFaceMeshLayersDrawLines(layers)) sets.push({ key: on.join("+"), layers })
}

mkdirSync(outDir, { recursive: true })
for (const f of readdirSync(outDir)) if (f.endsWith(".webp")) rmSync(join(outDir, f))
const files: Record<string, string> = {}
let total = 0
for (const { key, layers } of sets) {
  let clip = dep
  if (layers) {
    clip = join(work, `${key}.mp4`)
    const r = await drawFaceMeshVideo({ videoPath: src, drawOnPath: dep, layers, filters: FILTERS, outputPath: clip })
    if (r.facesDrawn === 0) throw new Error(`${key}: no face was drawn — widen the crop`)
  }
  save(key, await still(clip))
}

// The irises close up: the crop enlarged so the eyes' box is `size` wide, the irises drawn on it, cut to that box.
const scale = size / eyes[2]
const big = 2 * Math.round((side * scale) / 2) // even, for the encoder
const bigSrc = cut(source, "source-big.mp4", big)
const bigDep = cut(depth, "depth-big.mp4", big)
const closeup = join(work, "irises-closeup.mp4")
const r = await drawFaceMeshVideo({ videoPath: bigSrc, drawOnPath: bigDep, layers: { irises: true }, filters: FILTERS, outputPath: closeup })
if (r.facesDrawn === 0) throw new Error("irises-closeup: no face was drawn")
const left = Math.round((eyes[0] - cx) * scale), top = Math.round((eyes[1] - cy) * scale)
save("irises-closeup", await still(closeup, { left, top, width: Math.min(size, big - left), height: Math.min(size, big - top) }))

function save(key: string, webp: Buffer): void {
  const name = `${key.replaceAll("+", "-")}.${createHash("sha256").update(webp).digest("hex").slice(0, 8)}.webp`
  writeFileSync(join(outDir, name), webp)
  files[key] = `/face-mesh-art/${name}`
  total += webp.length
}

const entries = Object.entries(files).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")
writeFileSync(
  listPath,
  `// Written by backend/scripts/render-face-mesh-thumbnails.mts (how they are drawn, and how to draw them again, is
// said there) — do not edit by hand. Each set of face mesh layers that draws lines, keyed by the layers on
// (\`+\`-joined in VIDEO_FACE_MESH_LAYERS order), "depth" (no lines) and "irises-closeup" (the irises alone, the
// eyes close up): its illustration under frontend/public.

export const FACE_MESH_THUMBNAIL_FILES: Readonly<Record<string, string>> = {
${entries}
}
`,
)
rmSync(work, { recursive: true, force: true })
console.log(`${Object.keys(files).length} illustrations, ${(total / 1024).toFixed(1)} KB`)
process.exit(0)
