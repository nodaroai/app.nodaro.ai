/**
 * Apply EDL's render rule: the ONE effective EDL every ingress builds from a
 * wired / hand-written EDL plus the node's settings, and the ONE check of what
 * this renderer can draw.
 *
 * Both sides of the app run it. The backend's three ingresses (the REST route,
 * the DAG payload-builder, the MCP verb) refuse an EDL with it before any
 * credit is reserved; the editor judges the EDL an Apply EDL node would render
 * with it before the run (the config panel's badge). One source, so the badge
 * can never pass what the render refuses, or the other way round.
 *
 * It is NOT part of the public contract (decided 2026-10-04): the structural
 * EDL contract (`normalizeEdl`, `validateEdl`) is Apache `@nodaro/shared`;
 * this rule is what ONE renderer draws today, and it changes whenever that
 * renderer learns more (multi-slot layouts, regions). Publishing it would grant
 * an older validator that rejects newer EDLs. So it lives in this private
 * workspace package, under the root license, never published to npm.
 */
import {
  type Edl,
  type EdlSegment,
  EDL_SOURCE_ROLES,
  normalizeEdl,
  validateEdl,
  edlDurationMs,
  renderSettingsBasis,
  type RenderSettingsInput,
} from "@nodaro/shared"

/**
 * The longest OUTPUT one apply-edl render may produce: 180 minutes (product
 * decision 2026-09-24 — the 3-hour cap the podcast Phase-2 plan's F4 set on
 * apply-edl). THE one constant for it:
 *  - every ingress refuses a longer edit with a 400 naming both lengths
 *    (`validateEffectiveEdl` below — the REST route, the DAG payload-builder
 *    and the MCP verb all call it, before any credit is reserved), and the
 *    editor's Apply EDL badge refuses it the same way before a run;
 *  - the job's declared budget refuses to size one (`applyEdlJobBudgetMs` in
 *    the backend's budget leaf), so a payload that reached a worker WITHOUT
 *    passing ingress can never be budgeted past a 180-minute output — it gets
 *    the default ceilings instead.
 * Measured on the rendered output (`edlDurationMs`, crossfade overlaps
 * subtracted) — the same length the per-minute reserve is priced on.
 */
export const APPLY_EDL_MAX_OUTPUT_MS = 180 * 60_000

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
 * Callers then `validateEffectiveEdl` the result and refuse on `issues`.
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

const KNOWN_SOURCE_ROLES: ReadonlySet<string> = new Set(EDL_SOURCE_ROLES)

export interface ApplyEdlValidation {
  readonly ok: boolean
  readonly issues: readonly string[]
}

/**
 * Which check refused an EDL, one code per check, so a caller can say WHY
 * without reading the message (the editor's review inspector labels a locked
 * restore with it). The messages stay the wording every ingress returns.
 *  - "structural": the shared contract's `validateEdl`.
 *  - "output-cap": more than `APPLY_EDL_MAX_OUTPUT_MS` of output.
 *  - "unknown-role": a source role this renderer does not know.
 *  - "missing-url": a referenced source with no url.
 *  - "no-picture": a segment with no picture in a video-output edit.
 *  - "layout": a layout this renderer does not draw (mode, slots, emphasis,
 *    a layout transition other than a cut).
 *  - "region": a region crop, on a segment, a slot or a source.
 *  - "reads-before-source": a segment that starts before its source does.
 * The three checks of one source (`ApplyEdlSourceIssueCode`) also name it
 * (`sourceId`), so a caller can tell a problem on one source from the same
 * check failing on another (the review's restore lock compares them per
 * source, decided 2026-10-05).
 */
export type ApplyEdlIssueCode =
  | "structural"
  | "output-cap"
  | "unknown-role"
  | "missing-url"
  | "no-picture"
  | "layout"
  | "region"
  | "reads-before-source"

/** The checks that each find a problem with one source, and name it. */
export type ApplyEdlSourceIssueCode = "unknown-role" | "missing-url" | "reads-before-source"

export type ApplyEdlIssue =
  | {
      readonly code: ApplyEdlSourceIssueCode
      /** The id of the source the problem is with. */
      readonly sourceId: string
      readonly message: string
    }
  | {
      readonly code: Exclude<ApplyEdlIssueCode, ApplyEdlSourceIssueCode>
      readonly message: string
    }

/** The render rule's verdict as messages: what every ingress returns in its 400. */
export function validateEffectiveEdl(edl: Edl, output: "video" | "audio"): ApplyEdlValidation {
  const issues = findEffectiveEdlIssues(edl, output).map((issue) => issue.message)
  return { ok: issues.length === 0, issues }
}

/**
 * Full ingress validation: the structural `validateEdl` PLUS the executor
 * pre-conditions that would otherwise fail — or silently mis-render — after
 * credits are reserved: every referenced source must have a non-empty url, a
 * `video`-output edit must give every segment a picture source, nothing the
 * phase-1 renderer cannot render may be present (multi-slot layouts, layout
 * transitions other than "cut", regions), no source may carry a role this
 * executor does not know, and no segment may start before its source's origin.
 * Returns each issue with the code of the check that found it, in the order
 * `validateEffectiveEdl` lists their messages, so the route can 400 naming
 * exactly what is wrong. (Whether a segment runs PAST a source's end needs the
 * file itself and is checked by the executor after download — it fails naming
 * the segment, never clamps.)
 */
export function findEffectiveEdlIssues(edl: Edl, output: "video" | "audio"): readonly ApplyEdlIssue[] {
  const found: ApplyEdlIssue[] = validateEdl(edl).issues.map((message) => ({ code: "structural", message }))
  const add = (code: Exclude<ApplyEdlIssueCode, ApplyEdlSourceIssueCode>, message: string): void => {
    found.push({ code, message })
  }
  const addForSource = (code: ApplyEdlSourceIssueCode, sourceId: string, message: string): void => {
    found.push({ code, sourceId, message })
  }

  // The 3-hour cap (product decision 2026-09-24): one render may produce at
  // most `APPLY_EDL_MAX_OUTPUT_MS` of output, measured exactly as the reserve
  // is priced (`edlDurationMs`, overlaps subtracted). Refused HERE — before
  // any credit is reserved, at every ingress — so no render's time budget can
  // grow past that of a 180-minute output.
  const outputMs = edlDurationMs(edl)
  if (outputMs > APPLY_EDL_MAX_OUTPUT_MS) {
    // Rounded UP to a tenth, so an edit a few ms over never reads as "180".
    const over = Math.ceil(outputMs / 6_000) / 10
    const cap = APPLY_EDL_MAX_OUTPUT_MS / 60_000
    add(
      "output-cap",
      `the edit renders ${over} minutes of output — over the ${cap}-minute limit for one render; ` +
        `split it into parts of at most ${cap} minutes`,
    )
  }

  // An unknown role is only a WARNING in the shared contract (a newer producer
  // may know more roles), but this executor knows exactly EDL_SOURCE_ROLES, and
  // the one it acts on is "master-audio": a misspelled one would silently take
  // every segment's sound from its own camera. So it is PROMOTED to an issue
  // here — checked against the registry directly, never by parsing warnings.
  for (const s of edl.sources) {
    if (s.role !== undefined && !KNOWN_SOURCE_ROLES.has(s.role)) {
      addForSource("unknown-role", s.id, `source "${s.id}": unknown role "${s.role}" — this renderer knows only ${EDL_SOURCE_ROLES.join(", ")} (a misspelled "master-audio" would take each segment's sound from its own camera)`)
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
    if (s && (!s.url || !s.url.trim())) addForSource("missing-url", id, `source "${id}" has no url — resolve it or wire a \`sources\` override`)
  }

  if (output === "video") {
    edl.segments.forEach((seg, i) => {
      if (!seg.video) add("no-picture", `segment[${i}] "${seg.id}" has no video source (required for a video-output edit; use output:"audio" for an audio-only cut)`)
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
      add("layout", `${at}: layout mode "${layout.mode}" — this renderer shows one source full-frame per segment (multi-camera layouts are a speaker-view feature)`)
    }
    if (slots.length > 1) {
      add("layout", `${at}: layout with ${slots.length} slots — this renderer shows one source per segment (multi-slot layouts are a speaker-view feature)`)
    } else if (slots.length === 1 && seg.video && slots[0].source !== seg.video) {
      add("layout", `${at}: layout slot shows "${slots[0].source}" but the segment's video is "${seg.video}" — this renderer shows segment.video; make them agree or drop the layout`)
    }
    const emphasis = layout?.emphasis?.style
    if (emphasis !== undefined && emphasis !== "none") {
      add("layout", `${at}: layout emphasis "${emphasis}" is not renderable here (a speaker-view feature) — remove layout.emphasis`)
    }
    const lt = layout?.transition?.type
    if (lt !== undefined && lt !== "cut") {
      add("layout", `${at}: layout transition "${lt}" is not renderable here (only "cut", or a segment \`transition\` of type "crossfade", is) — remove it or use segment.transition`)
    }
    if (seg.region) add("region", `${at}: region crops are not renderable here (a speaker-view feature) — remove segment.region`)
    for (const slot of slots) {
      if (slot.region) add("region", `${at}: slot "${slot.source}" has a region crop — not renderable here (a speaker-view feature)`)
    }
  })
  for (const s of edl.sources) {
    if (s.region) add("region", `source "${s.id}": region crops are not renderable here (a speaker-view feature) — remove source.region`)
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
        addForSource("reads-before-source", id, `${at}: starts at ${seg.inMs}ms on the master clock but source "${id}" begins at ${offset}ms (offsetMs) — the segment would read before the source starts`)
      }
    }
  })

  return found
}

/**
 * The `renderBasis` a render is stamped with (R19 a, decided 2026-10-06): its
 * own settings and the EFFECTIVE sources of the cut it renders — the URL of
 * each source of `effectiveEdl` (`buildEffectiveEdl`, the wired overrides
 * applied), in order. The ingresses that build the effective EDL stamp it, and
 * the editor compares a take with it, so both read the sources one way.
 */
export function effectiveRenderBasis(effectiveEdl: Edl, settings: RenderSettingsInput): string {
  return renderSettingsBasis(settings, effectiveEdl.sources.map((s) => s.url))
}
