/**
 * Character LoRA training helpers.
 *
 * Five exports:
 *  - collectTrainingImages: aggregate every URL eligible for the trainer.
 *  - zipImagesToR2Buffer: buffer-zip + upload to R2 (returns public URL).
 *  - buildTriggerWord: derive `TOK_<slug>_<6hex>` from character name.
 *  - selectLoraRoutingForMentions: decide whether to use LoRA inference path.
 *    NOTE: this helper is also used by the frontend single-node Run via
 *    `@nodaro/shared` (Task 20 mirrors it there); the backend orchestrator
 *    imports it directly from this file.
 *  - refundReservedCreditsForJob: idempotent refund of reserved credits for
 *    a given job. Mirrors the pattern in `routes/cancel-jobs.ts:18-35`.
 */

import crypto from "node:crypto"
import archiver from "archiver"
import { uploadBufferToR2 } from "./storage.js"
import { safeFetch } from "./safe-fetch.js"
import { characterMentionSlug } from "@nodaro/shared"

// ─────────────────────────────────────────────────────────────────────────────
// Training-image aggregation
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingImageSource {
  url: string
  /** Filename hint inside the zip (e.g. "source", "expr_smile"). */
  label: string
}

export class InsufficientImagesError extends Error {
  readonly code = "insufficient_training_images"
  constructor(public readonly count: number) {
    super(
      `Need at least 4 reference photos to train (have ${count}). Add more expressions, poses, or angles in the asset library.`,
    )
  }
}

interface CharacterRowForTraining {
  source_image_url?: string | null
  reference_photos?: ReadonlyArray<{ url?: string; kind?: string }> | null
  expressions?: ReadonlyArray<{ url?: string; name?: string }> | null
  poses?: ReadonlyArray<{ url?: string; name?: string }> | null
  angles?: ReadonlyArray<{ url?: string; name?: string }> | null
  body_angles?: ReadonlyArray<{ url?: string; name?: string }> | null
  lighting_variations?: ReadonlyArray<{ url?: string; name?: string }> | null
}

/**
 * Order: source → reference_photos → expressions → poses → angles
 * → body_angles → lighting_variations. De-duped by URL, capped at 20.
 * Throws InsufficientImagesError if < 4.
 *
 * Excluded:
 *  - `motions` — video frames don't help image LoRA training.
 *  - `character_sheet` — its 4-view composite (`frontView/sideView/backView/
 *    combinedSheet`) is already covered by `angles` + `body_angles` +
 *    `reference_photos`. The DB column shape is a `{frontView, sideView,
 *    backView, combinedSheet}` object, not a `{url}` object.
 */
export function collectTrainingImages(
  c: CharacterRowForTraining,
): readonly TrainingImageSource[] {
  const out: TrainingImageSource[] = []
  if (c.source_image_url) out.push({ url: c.source_image_url, label: "source" })
  for (const r of c.reference_photos ?? []) {
    if (r.url) out.push({ url: r.url, label: `ref_${r.kind ?? "x"}` })
  }
  for (const a of c.expressions ?? []) {
    if (a.url) out.push({ url: a.url, label: `expr_${a.name ?? "x"}` })
  }
  for (const a of c.poses ?? []) {
    if (a.url) out.push({ url: a.url, label: `pose_${a.name ?? "x"}` })
  }
  for (const a of c.angles ?? []) {
    if (a.url) out.push({ url: a.url, label: `angle_${a.name ?? "x"}` })
  }
  for (const a of c.body_angles ?? []) {
    if (a.url) out.push({ url: a.url, label: `body_${a.name ?? "x"}` })
  }
  for (const a of c.lighting_variations ?? []) {
    if (a.url) out.push({ url: a.url, label: `light_${a.name ?? "x"}` })
  }

  const seen = new Set<string>()
  const deduped = out.filter((x) => {
    if (seen.has(x.url)) return false
    seen.add(x.url)
    return true
  })
  if (deduped.length < 4) throw new InsufficientImagesError(deduped.length)
  return deduped.slice(0, 20)
}

// ─────────────────────────────────────────────────────────────────────────────
// Zip + upload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all images first (so a mid-loop failure doesn't leave a half-finalized
 * zip in R2), then zip in memory, then upload via `uploadBufferToR2` which
 * returns a public R2 URL (no signing needed — Replicate fetches it directly).
 *
 * Memory profile: 20 imgs × ~5MB ≈ 100MB peak. Acceptable on Railway prod;
 * watch for OOM on hobby plans (512MB). If pressure surfaces, swap to streamed
 * `@aws-sdk/lib-storage::Upload`.
 */
export async function zipImagesToR2Buffer(
  images: readonly TrainingImageSource[],
  characterId: string,
  userId: string,
): Promise<{ key: string; url: string }> {
  const key = `character-training/${characterId}/${Date.now()}.zip`

  // Phase 1: fetch all images into Buffers — concurrently. Peak memory is
  // already bounded by the in-memory zip (~100MB for 20×5MB), so firing
  // 20 fetches in parallel doesn't change the ceiling but cuts wall time
  // from ~10s sequential to ~1-2s.
  const fetched = await Promise.all(
    images.map(async (src) => {
      // safeFetch (not global fetch): these URLs originate from user-supplied
      // character asset fields and the fetched bytes are zipped to an R2 key the
      // requester can download — a non-blind SSRF read-oracle without DNS-aware
      // IP validation. safeUrlSchema gates the literal-IP case at the route;
      // safeFetch closes the DNS-rebinding case at connect time. See safe-fetch.ts.
      const res = await safeFetch(src.url, { timeoutMs: 30_000 })
      if (!res.ok) throw new Error(`Fetch ${src.url} → ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const ct = res.headers.get("content-type") ?? "image/jpeg"
      const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg"
      return { buf, label: src.label, ext }
    }),
  )

  // Phase 2: build the zip in memory.
  const archive = archiver("zip", { zlib: { level: 6 } })
  const chunks: Buffer[] = []
  archive.on("data", (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", () => resolve())
    archive.on("error", reject)
  })
  for (let i = 0; i < fetched.length; i++) {
    const f = fetched[i]
    archive.append(f.buf, {
      name: `${String(i).padStart(2, "0")}_${f.label}.${f.ext}`,
    })
  }
  await archive.finalize()
  await done

  const url = await uploadBufferToR2(
    Buffer.concat(chunks),
    key,
    "application/zip",
    userId,
  )
  return { key, url }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger word
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `TOK_<slug>_<6hex>`. Slug derived from name via shared helper; falls back
 * to `"char"` for empty/symbolic-only names. Six hex chars (24 bits) is
 * enough collision-resistance within one user's namespace.
 */
export function buildTriggerWord(name: string): string {
  const slug = characterMentionSlug(name) || "char"
  const tail = crypto.randomBytes(3).toString("hex")
  return `TOK_${slug}_${tail}`
}

// ─────────────────────────────────────────────────────────────────────────────
// LoRA routing decision — single source of truth in @nodaro/shared so the
// backend orchestrator and the frontend single-node Run agree byte-for-byte.
// ─────────────────────────────────────────────────────────────────────────────

export { selectLoraRoutingForMentions } from "@nodaro/shared"
export type { LoraRouting, LoraEligibleRef } from "@nodaro/shared"

// Re-export so existing `from "./character-lora.js"` imports keep working.
// Canonical implementation lives in `credits-job-lifecycle.ts`.
export { refundReservedCreditsForJob } from "./credits-job-lifecycle.js"
