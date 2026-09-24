/**
 * apply-edl — the ONE effective-EDL + pricing helper shared by the route, the
 * DAG payload-builder, and the worker executor, so all three agree on the
 * SAME normalized EDL, the SAME rendered duration, and the SAME reserve.
 *
 * The pure EDL contract (`@nodaro/shared`) is structural vocabulary; this file
 * is the app-side glue that turns a wired/hand-written EDL + the node's
 * settings into the concrete plan the executor renders. It stays in `backend/`
 * (SUL) — the executor is not part of the public wire/SDK contract, so nothing
 * here is a new `@nodaro/shared` export.
 */
import {
  type Edl,
  type EdlSegment,
  EDL_SOURCE_ROLES,
  normalizeEdl,
  validateEdl,
  edlDurationMs,
} from "@nodaro/shared"

/** Base credits per MINUTE of RENDERED output. Single source of truth for the
 *  per-minute rate: `STATIC_CREDIT_COSTS['apply-edl']` (ee/billing/credits.ts)
 *  and the `model_pricing` migration row both mirror this value.
 *
 *  PROVISIONAL — set by the 3-hour staging probe (re-derived from measured
 *  ffmpeg s/output-min, never scaled). Same order of magnitude as the flat
 *  ffmpeg render nodes (combine-videos = 30 flat). apply-edl is priced per
 *  output minute because a tightened episode's cut can be minutes long. */
export const APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE = 10

export interface EffectiveEdlOptions {
  /** Default crossfade (ms) applied at every segment boundary that carries NO
   *  explicit transition. Per-boundary clamped to `0.9·min(adjacent)` — the
   *  ffmpeg-xfade limit `validateEdl` enforces — so a global value can never
   *  silently over-blend a short segment. 0 (default) = hard cuts. */
  crossfadeMs?: number
  /** Optional media-URL overrides for `EdlSource[i].url`, POSITIONAL in edge
   *  order (the node's `sources` input). A present entry replaces that source's
   *  url; absent/empty keeps the EDL's own url (the primary contract). */
  sourceOverrides?: ReadonlyArray<string | undefined>
}

const clampBoundaryCrossfade = (raw: number, seg: EdlSegment, prev: EdlSegment): number => {
  const minAdj = Math.min(seg.outMs - seg.inMs, prev.outMs - prev.inMs)
  // floor(0.9·min) keeps it STRICTLY under validateEdl's `0.9·min + 1e-9` bound.
  return Math.min(Math.round(raw), Math.floor(0.9 * minAdj))
}

/**
 * Turn a raw (wired / hand-written) EDL plus the node settings into the single
 * effective EDL every stage renders, reserves, and remaps against. Pure and
 * deterministic:
 *   1. `normalizeEdl` (defaults, integer ms, region-fit, order preserved).
 *   2. positional `sourceOverrides` onto `EdlSource.url`.
 *   3. inject the default `crossfadeMs` on boundaries with no transition,
 *      per-boundary clamped so `validateEdl` can never reject what we built.
 *   4. `normalizeEdl` again so the injected fields land in canonical shape.
 * Callers then `validateEdl` the result and 400/throw on `issues`.
 */
export function buildEffectiveEdl(rawEdl: unknown, opts: EffectiveEdlOptions = {}): Edl {
  let edl = normalizeEdl(rawEdl)

  if (opts.sourceOverrides && opts.sourceOverrides.length > 0) {
    edl = {
      ...edl,
      sources: edl.sources.map((s, i) => {
        const url = opts.sourceOverrides?.[i]
        // Guard the type: computeCredits runs on RAW pre-Zod body.sources, so a
        // non-string entry (e.g. `sources:[123]`) would TypeError on `.trim()`
        // and surface as a 500 instead of the handler's clean 400.
        return typeof url === "string" && url.trim() ? { ...s, url: url.trim() } : s
      }),
    }
  }

  const cf = Math.max(0, Math.round(opts.crossfadeMs ?? 0))
  if (cf > 0 && edl.segments.length > 1) {
    const segments = edl.segments.map((seg, i) => {
      if (i === 0) return seg
      // An explicit transition (either field) wins — never overwrite the EDL's
      // own editorial decision with the node default.
      if (seg.transition || seg.layout?.transition) return seg
      const bounded = clampBoundaryCrossfade(cf, seg, edl.segments[i - 1])
      if (bounded <= 0) return seg
      return { ...seg, transition: { type: "crossfade" as const, durationMs: bounded } }
    })
    edl = { ...edl, segments }
  }

  return normalizeEdl(edl)
}

/** Minutes of RENDERED output to reserve for — `ceil(edlDurationMs/60000)`,
 *  minimum 1. Runs on the EFFECTIVE EDL so the D17 overlap compression is
 *  already accounted for (a crossfade-heavy cut reserves less). */
export function applyEdlReserveMinutes(edl: Edl): number {
  return Math.max(1, Math.ceil(edlDurationMs(edl) / 60_000))
}

/** BASE credits (pre-markup) the route reserves via `creditGuard.computeCredits`.
 *  `creditGuard` applies the service markup so check and reserve see the same
 *  final number; the DAG reserves the SAME base via `applyEdlCreditOverride`. */
export function applyEdlBaseCredits(edl: Edl): number {
  return APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * applyEdlReserveMinutes(edl)
}

const KNOWN_SOURCE_ROLES: ReadonlySet<string> = new Set(EDL_SOURCE_ROLES)

export interface ApplyEdlValidation {
  readonly ok: boolean
  readonly issues: readonly string[]
}

/**
 * Full ingress validation: the structural `validateEdl` PLUS the executor
 * pre-conditions that would otherwise fail — or silently mis-render — after
 * credits are reserved: every referenced source must have a non-empty url, a
 * `video`-output edit must give every segment a picture source, nothing the
 * phase-1 renderer cannot render may be present (multi-slot layouts, layout
 * transitions other than "cut", regions), no source may carry a role this
 * executor does not know, and no segment may start before its source's origin.
 * Returns issues so the route can 400 naming exactly what is
 * wrong. (Whether a segment runs PAST a source's end needs the file itself and
 * is checked by the executor after download — it fails naming the segment,
 * never clamps.)
 */
export function validateEffectiveEdl(edl: Edl, output: "video" | "audio"): ApplyEdlValidation {
  const base = validateEdl(edl)
  const issues = [...base.issues]

  // An unknown role is only a WARNING in the shared contract (a newer producer
  // may know more roles), but this executor knows exactly EDL_SOURCE_ROLES, and
  // the one it acts on is "master-audio": a misspelled one would silently take
  // every segment's sound from its own camera. So it is PROMOTED to an issue
  // here — checked against the registry directly, never by parsing warnings.
  for (const s of edl.sources) {
    if (s.role !== undefined && !KNOWN_SOURCE_ROLES.has(s.role)) {
      issues.push(`source "${s.id}": unknown role "${s.role}" — this renderer knows only ${EDL_SOURCE_ROLES.join(", ")} (a misspelled "master-audio" would take each segment's sound from its own camera)`)
    }
  }

  // Every source the segments reference must resolve to a real url (the
  // executor downloads from `EdlSource.url`). validateEdl already flags empty
  // urls; this re-states it per referenced id for a friendlier 400.
  const byId = new Map(edl.sources.map((s) => [s.id, s]))
  const referenced = new Set<string>()
  for (const seg of edl.segments) {
    if (seg.video) referenced.add(seg.video)
    if (seg.audio) referenced.add(seg.audio)
    for (const slot of seg.layout?.slots ?? []) referenced.add(slot.source)
  }
  for (const s of edl.sources) if (s.role === "master-audio") referenced.add(s.id)
  for (const id of referenced) {
    const s = byId.get(id)
    if (s && (!s.url || !s.url.trim())) issues.push(`source "${id}" has no url — resolve it or wire a \`sources\` override`)
  }

  if (output === "video") {
    edl.segments.forEach((seg, i) => {
      if (!seg.video) issues.push(`segment[${i}] "${seg.id}" has no video source (required for a video-output edit; use output:"audio" for an audio-only cut)`)
    })
  }

  // What this executor cannot render is REFUSED here, never silently dropped.
  // The contract carries phase-2 presentation fields (multi-slot layouts, pan /
  // zoom / xfade switches, regions) that the phase-1 renderer ignores — and a
  // layout xfade it ignored would still have its overlap subtracted by
  // `edlDurationMs`, so the reserve and the caption remap would describe a
  // shorter render than the one delivered. A user who wrote them gets a 400
  // naming the segment, not a hard-cut full-frame render at the wrong price.
  // A `layout` is renderable here only when it describes exactly what this
  // renderer does anyway: mode "single", at most one slot and that slot IS
  // `segment.video`, no emphasis, a cut. Anything else would render as
  // something other than what the EDL says it shows.
  edl.segments.forEach((seg, i) => {
    const at = `segment[${i}] "${seg.id}"`
    const layout = seg.layout
    const slots = layout?.slots ?? []
    if (layout && layout.mode !== "single") {
      issues.push(`${at}: layout mode "${layout.mode}" — this renderer shows one source full-frame per segment (multi-camera layouts are a speaker-view feature)`)
    }
    if (slots.length > 1) {
      issues.push(`${at}: layout with ${slots.length} slots — this renderer shows one source per segment (multi-slot layouts are a speaker-view feature)`)
    } else if (slots.length === 1 && seg.video && slots[0].source !== seg.video) {
      issues.push(`${at}: layout slot shows "${slots[0].source}" but the segment's video is "${seg.video}" — this renderer shows segment.video; make them agree or drop the layout`)
    }
    const emphasis = layout?.emphasis?.style
    if (emphasis !== undefined && emphasis !== "none") {
      issues.push(`${at}: layout emphasis "${emphasis}" is not renderable here (a speaker-view feature) — remove layout.emphasis`)
    }
    const lt = layout?.transition?.type
    if (lt !== undefined && lt !== "cut") {
      issues.push(`${at}: layout transition "${lt}" is not renderable here (only "cut", or a segment \`transition\` of type "crossfade", is) — remove it or use segment.transition`)
    }
    if (seg.region) issues.push(`${at}: region crops are not renderable here (a speaker-view feature) — remove segment.region`)
    for (const slot of slots) {
      if (slot.region) issues.push(`${at}: slot "${slot.source}" has a region crop — not renderable here (a speaker-view feature)`)
    }
  })
  for (const s of edl.sources) {
    if (s.region) issues.push(`source "${s.id}": region crops are not renderable here (a speaker-view feature) — remove source.region`)
  }

  // A segment must exist on the source it reads. `masterMs = sourceMs + offsetMs`,
  // so a segment starting before a source's origin would ask for negative source
  // time. It is refused here, before anything is reserved (and the executor's
  // window check refuses it too — it never clamps to the source's first frame).
  // "Reads" is the executor's rule exactly: the picture source only for a video
  // output (an audio cut never touches it), the sound source always.
  const masterAudioId = edl.sources.find((s) => s.role === "master-audio")?.id
  edl.segments.forEach((seg, i) => {
    const at = `segment[${i}] "${seg.id}"`
    const reads = new Set<string>()
    if (output === "video" && seg.video) reads.add(seg.video)
    const audio = seg.audio ?? masterAudioId ?? seg.video
    if (audio) reads.add(audio)
    for (const id of reads) {
      const src = byId.get(id)
      if (!src) continue
      const offset = src.offsetMs ?? 0
      if (seg.inMs < offset) {
        issues.push(`${at}: starts at ${seg.inMs}ms on the master clock but source "${id}" begins at ${offset}ms (offsetMs) — the segment would read before the source starts`)
      }
    }
  })

  return { ok: issues.length === 0, issues }
}

/**
 * DAG-side reserve override (probe-at-reserve, but the duration is KNOWN from
 * the effective EDL carried on the payload — no ffprobe needed). Mirrors
 * `lib/dubbing-pricing.ts::projectDubbingCreditOverride`: the workflow dispatch
 * bypasses the HTTP route's `computeCredits`, so it reserves the same
 * per-minute base × minutes (with markup) that a single-node Run would.
 * Returns `undefined` for any other job so the `??` chain in node-executor
 * falls through.
 */
export async function applyEdlCreditOverride(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<number | undefined> {
  if (jobName !== "apply-edl") return undefined
  const edl = payload.edl as Edl | undefined
  if (!edl || !Array.isArray(edl.segments)) return undefined
  const minutes = applyEdlReserveMinutes(edl)
  const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
  const { creditCost } = await getModelCreditBaseCost("apply-edl")
  const { applyServiceMarkup } = await import("../ee/billing/service-margin.js")
  const { getAppSettings } = await import("./app-settings.js")
  return applyServiceMarkup(creditCost * minutes, await getAppSettings(), "apply-edl")
}
