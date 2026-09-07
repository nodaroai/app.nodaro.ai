/**
 * `buildFramingRequest` — ONE assembly of a framing run's structured inputs,
 * for the studio's hook and for the platform's own generation route (D6).
 *
 * A framing run is a `generate-image` call. What goes on that call used to be
 * assembled in the browser (`useStartFraming` plus the `bindMentionTokens` seam
 * above it); this is the same assembly as a pure function over the DOCUMENT, so
 * a run started from the editor, from an agent and from the route carries
 * byte-identical params. The submitter is still whoever called: the builder
 * starts nothing, fans nothing out, and knows no client.
 *
 * WHAT IT DOES NOT DO, on purpose:
 *  - **it never assembles the PROMPT.** Studio sends the raw prose plus the
 *    structured levers — `connectedReferences`, `direction` (catalog IDS, never
 *    baked hint text), `subject`, `referenceImageUrls` — and `/v1/generate-image`
 *    composes the hints and folds the refs server-side through Nodaro's own
 *    `assembleImageInput`. The one rewrite here is the MENTION binding below,
 *    which is a wire spelling of what the prose already says.
 *  - **it fans nothing out.** A batch is N identical calls; `count` says how
 *    many and the caller makes them (the single-node route is single-shot).
 *  - **it mints no marker.** The `pendingStills` marker and `land_job` are
 *    P1.2's; {@link FramingRequest.echo} is exactly the restore context that
 *    marker will carry.
 *
 * THE TWO PROMPTS. `params.prompt` is the WIRE prose — each bound chip's name
 * rewritten into the platform mention grammar (`@jack-mercer:1`) so the route
 * resolves the reference INLINE instead of degrading it to a nameless trailing
 * role phrase. `echo.prompt` is the RAW prose the user wrote, which is what a
 * result records and what a strip-click re-seeds, so chips rebuild by name
 * (spec `2026-08-30-structured-prompt-assembly`, D1: the binding is WIRE-ONLY).
 *
 * `{ref:<id>}` is NOT a framing grammar. It is the DIRECTING lane's token
 * (`bindReferenceTokens`, `directing-references.ts`), where the route numbers
 * the references itself and substitutes an `@image_N` seat. The framing route
 * resolves mentions inline and never sees one — see `buildDirectingRequest`.
 *
 * Browser-free and pure: no React, no `import.meta.env`, no clock, no network,
 * and the production it reads comes back untouched.
 */
import type { ConnectedReference, DescribedReference } from "@nodaro/shared"
import type { DirectionFields, SubjectFields } from "@nodaro/prompts"

import { MAX_CANDIDATES } from "../candidates"
import { opError } from "../ops/errors"
import type { Production } from "../ops/production"
import { bindMentionTokens } from "../prompt-mentions"
import type { LookSelectionMap, Shot } from "../shot"
import { resolveCatalogGates, type RequestContext } from "./context"
import { nameDescribedRoles } from "./described-prose"

/**
 * The `/v1/generate-image` body, as a LOCAL structural interface.
 *
 * Deliberately not the SDK's type: the package cannot depend on `@nodaro/sdk`
 * (the SDK depends on the wire types, and the studio app depends on both), so
 * the contract is restated here as the narrow shape this builder writes. The
 * route's own zod schema stays the authority — a field added there reaches this
 * file as a compile error at the call site, which is the seam we want.
 */
export interface GenerateImageParams {
  /** The WIRE prose — mention-bound (see the module header). */
  readonly prompt: string
  readonly provider: string
  readonly aspectRatio?: string
  readonly resolution?: string
  /** The bound chips, in the wire shape the binder produced. */
  readonly connectedReferences?: ReadonlyArray<ConnectedReference>
  /** The roles the prose names that have words but no face (R7). */
  readonly describedReferences?: ReadonlyArray<DescribedReference>
  /** Cinematic direction as catalog IDS — the route folds them once. */
  readonly direction?: DirectionFields
  /** The Structured Subject ids. */
  readonly subject?: SubjectFields
  /** Manual uploads (the flat channel; the route gates them per provider). */
  readonly referenceImageUrls?: ReadonlyArray<string>
  readonly negativePrompt?: string
  /** The platform's measured reference-compliance wording (D5). */
  readonly referenceLock?: "standard" | "multi-person"
  /** Server-side prompt expansion (Enhance). */
  readonly expandPrompt?: true
  readonly workflowId?: string
}

/**
 * What the CALL owns, over what the document says.
 *
 * Every field here has a home on the shot's `plan.frame` and falls back to it
 * (D13: in Phase 3 the Composer's draft IS the plan). The split is the
 * scaffold's: a value the document owns is read, a value the call owns is
 * passed, and an override always wins.
 */
export interface FramingOverrides {
  /** The RAW prose. Falls back to the shot's `plan.frame.prompt`. */
  readonly prompt?: string
  /** The image model. Falls back to `plan.frame.provider`; required in the end. */
  readonly provider?: string
  readonly aspectRatio?: string
  readonly resolution?: string
  /** Candidates to fan out; clamped into `[1, MAX_CANDIDATES]`. */
  readonly count?: number
  readonly negativePrompt?: string
  /** Cinematic ids for the wire. Never projected from the document here — the
   *  film and scene look LAYERS merge in the Composer, and inventing that merge
   *  server-side would send a fold the editor never showed. */
  readonly direction?: DirectionFields
  /**
   * Structured Subject ids for the wire. Like {@link direction}, never
   * projected from the document here: `PlanFrame.subject` is the PICKER
   * selection, and turning one into wire fields is gated on the Composer's
   * structured mode (`useComposerProjections`) — a gate the document does not
   * carry. Passing the projection in keeps the wire honest.
   */
  readonly subject?: SubjectFields
  /** Manual reference uploads; falls back to `plan.frame.referenceImageUrls`. */
  readonly extraReferenceImageUrls?: ReadonlyArray<string>
  readonly expandPrompt?: boolean
  /** ECHO-ONLY (never sent): the look ids this run was projected from, their
   *  layer split, and the prompt-format marker the run's results inherit. */
  readonly promptFormat?: 2
  readonly look?: LookSelectionMap
  readonly filmLook?: LookSelectionMap
  readonly sceneLook?: LookSelectionMap
  readonly workflowId?: string
}

/**
 * The RESTORE context every result of this run records — the hook's
 * `StartedFraming` minus the ids only a submitter can know (`batchId`,
 * `jobIds`). P1.2's pending-still marker carries exactly this.
 *
 * `prompt` is the RAW prose, never the wire one: a strip-click must re-seed the
 * editable text, not the bound grammar.
 */
export interface FramingEcho {
  readonly prompt: string
  readonly provider: string
  readonly referenceImageUrls?: ReadonlyArray<string>
  readonly negativePrompt?: string
  readonly promptFormat?: 2
  readonly look?: LookSelectionMap
  readonly filmLook?: LookSelectionMap
  readonly sceneLook?: LookSelectionMap
  readonly subject?: SubjectFields
}

/** One framing run: what to call, how many times, and what its results record. */
export interface FramingRequest {
  readonly type: "generate-image"
  /** How many identical calls the caller should make (1 = a single still). */
  readonly count: number
  readonly params: GenerateImageParams
  readonly echo: FramingEcho
}

/** Clamp a requested count into `[1, MAX_CANDIDATES]`; non-finite → 1. */
function clampCount(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return 1
  return Math.min(MAX_CANDIDATES, Math.max(1, Math.floor(n)))
}

/**
 * The described roles WORTH SENDING — a local twin of the studio's
 * `wireDescribedReferences`, which stayed in the app with the editor code that
 * reports the wordless ones.
 *
 * The editor reports every described role the prose names, wordless ones
 * included — it is reading the document. The wire is where that stops being
 * true: a described reference exists to tell the model who a name is, and one
 * with nothing to say renders `<Name> — .`, which is noise. Omit-when-empty,
 * like every other optional channel: the route's gates read presence.
 */
function wireDescribedReferences(
  described: ReadonlyArray<DescribedReference> | undefined,
): ReadonlyArray<DescribedReference> | undefined {
  const out = described?.filter((d) => d.description.trim()) ?? []
  return out.length ? out : undefined
}

/**
 * The D5 reference-compliance token (spec `2026-08-30-structured-prompt-
 * assembly`, decided 2026-08-31): opt the run into the platform's field-tested
 * wording exactly where it was measured to matter. >=2 attached references (the
 * multi-reference composition case) → `"standard"`; >=2 DISTINCT bound
 * characters (two faces in play) → the face-clause variant. Single-ref runs stay
 * bare (the short-block-works-in-general population finding). An ID rides the
 * wire, never text, so improved wording ships without a studio release.
 */
function referenceLockFor(
  references: ReadonlyArray<ConnectedReference>,
  uploads: ReadonlyArray<string>,
): GenerateImageParams["referenceLock"] {
  const attached = references.filter((r) => r.url).length + uploads.length
  const faceIds = new Set(
    references.filter((r) => r.source === "wired-character" && r.url).map((r) => r.id),
  )
  if (faceIds.size >= 2) return "multi-person"
  return attached >= 2 ? "standard" : undefined
}

/** A non-empty map, or `undefined` — the omit-when-empty rule for the echo. */
function nonEmptyLook(
  look: LookSelectionMap | undefined,
): LookSelectionMap | undefined {
  return look && Object.keys(look).length ? look : undefined
}

/** The shot this run belongs to, or the one failure shape the package has. */
function shotOf(production: Production, shotId: string): Shot {
  const shot = production.shots.find((s) => s.id === shotId)
  if (!shot) throw opError("op_target_missing", `No shot ${shotId} in this production.`)
  return shot
}

/**
 * The `generate-image` call this shot's framing run would make — or `null` when
 * there is nothing to run.
 *
 * `null` rather than a throw for an EMPTY submit, exactly as the hook returns
 * `null`: a bound chip, a direction id, a subject id or an uploaded reference
 * can each fill an otherwise-empty prompt, so emptiness is only "no signal at
 * all", and that is a caller state, not an error. A missing shot or a run with
 * no model IS an error ({@link opError}).
 */
export function buildFramingRequest(
  production: Production,
  shotId: string,
  overrides: FramingOverrides = {},
  ctx: RequestContext = {},
): FramingRequest | null {
  const shot = shotOf(production, shotId)
  const plan = shot.plan?.frame
  const gates = resolveCatalogGates(ctx)

  const provider = overrides.provider ?? plan?.provider
  if (!provider)
    throw opError(
      "op_invalid",
      `No image model for the framing run of shot ${shotId}.`,
    )

  const raw = (overrides.prompt ?? plan?.prompt ?? "").trim()
  // The chips the composer bound, or — with none in hand — the ones the shot's
  // own plan carries. Never both: a caller that passes chips is authoring now.
  const chips = ctx.chips ?? plan?.references ?? []
  const uploads = overrides.extraReferenceImageUrls ?? plan?.referenceImageUrls ?? []
  const direction = overrides.direction
  const subject = overrides.subject
  const describedReferences = wireDescribedReferences(ctx.describedReferences)

  // A bound chip / direction id / subject id / uploaded ref can each fill an
  // otherwise-empty prompt — don't bail on empty text alone.
  const hasSignal =
    !!raw ||
    chips.length > 0 ||
    (!!direction && Object.keys(direction).length > 0) ||
    (!!subject && Object.keys(subject).length > 0) ||
    uploads.length > 0
  if (!hasSignal) return null

  // THE WIRE BINDING (D1). Each bound chip's NAME becomes `@<slug>:<index>` so
  // the route resolves the reference inline; a bound IMAGE chip's wire shape
  // drops `isExtraRef` (the platform refuses a mention on an extra), which is
  // why the reference list and the prose are ONE decision and come back
  // together. The RAW prose is echoed below, untouched.
  //
  // …and then every DESCRIBED role's token becomes its human word (R7). That
  // channel correlates with the prose BY NAME, so a wire saying `@natalie`
  // beside an identity line saying "Natalie" names nobody — and the platform's
  // mention grammar addresses only `@slug:N`, so the bare token would ride
  // literally to the model. Studio does this INSIDE the binder, as its third
  // argument (`Studio.tsx`'s framing submit); the codec snapshot here predates
  // that parameter, so the pass runs on the binder's output — the same
  // composition, since it is the last thing to touch the prose either way.
  // The list is the UNFILTERED one: a WORDLESS role gets its word back in the
  // prose even though `wireDescribedReferences` drops it from the channel.
  const bound = bindMentionTokens(raw, chips)
  const wirePrompt = nameDescribedRoles(bound.wirePrompt, ctx.describedReferences)
  const wireReferences = bound.wireReferences

  const negativePrompt =
    gates.negativePromptSupported("image", provider) &&
    (overrides.negativePrompt ?? plan?.negativePrompt)?.trim()
      ? (overrides.negativePrompt ?? plan?.negativePrompt)!.trim()
      : undefined
  const referenceLock = referenceLockFor(wireReferences, uploads)

  const params: GenerateImageParams = {
    prompt: wirePrompt,
    provider,
    ...(overrides.aspectRatio ?? plan?.aspectRatio
      ? { aspectRatio: overrides.aspectRatio ?? plan?.aspectRatio }
      : {}),
    ...(overrides.resolution ?? plan?.resolution
      ? { resolution: overrides.resolution ?? plan?.resolution }
      : {}),
    // Omit-when-empty is load-bearing on this route, not tidiness: an empty
    // `direction: {}` is truthy for `isStructuredImageMode`, which also relaxes
    // the prompt to `.min(0)` — see `directionWireFields`, whose own
    // omit-when-empty this guard is the second door to.
    ...(wireReferences.length ? { connectedReferences: wireReferences } : {}),
    ...(describedReferences ? { describedReferences } : {}),
    ...(direction && Object.keys(direction).length ? { direction } : {}),
    ...(subject && Object.keys(subject).length ? { subject } : {}),
    ...(uploads.length ? { referenceImageUrls: uploads } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(referenceLock ? { referenceLock } : {}),
    ...(overrides.expandPrompt ? { expandPrompt: true as const } : {}),
    ...(overrides.workflowId ? { workflowId: overrides.workflowId } : {}),
  }

  const echo: FramingEcho = {
    // The RAW prose, never `wirePrompt` — chips restore by name (D1).
    prompt: raw,
    provider,
    ...(uploads.length ? { referenceImageUrls: uploads } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
    // The submit's own verdict on what `prompt` above IS: raw prose (2, ids
    // ride alongside) or a restored legacy prompt with the clauses already
    // baked in (absent). Echoed, never invented — stamping `2` on a suppressed
    // run would launder baked prose into "raw" and fold the same clause twice.
    ...(overrides.promptFormat ? { promptFormat: overrides.promptFormat } : {}),
    // …and the look ids with their layer split (D-A1), omit-when-empty so a
    // layer that was genuinely empty at submit stays absent: its PRESENCE is
    // the discriminator a restore reads.
    ...(nonEmptyLook(overrides.look) ? { look: overrides.look } : {}),
    ...(nonEmptyLook(overrides.filmLook) ? { filmLook: overrides.filmLook } : {}),
    ...(nonEmptyLook(overrides.sceneLook) ? { sceneLook: overrides.sceneLook } : {}),
    ...(subject && Object.keys(subject).length ? { subject } : {}),
  }

  return { type: "generate-image", count: clampCount(overrides.count ?? plan?.count), params, echo }
}
