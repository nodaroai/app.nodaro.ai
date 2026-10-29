import { nodaroMotionEngineFrom } from "@nodaro/shared/models"
import type { NodaroClientCore } from "../core.js"

/**
 * Nodaro Motion (the `castSwap` resource; routes `/v1/cast-swap`) — replace
 * the people, pets, products and/or the location in a short video with your
 * own references, keeping its motion, framing, timing and sound (the clip's
 * audio is kept, and the result is the clip's length).
 *
 * Before the video, each person, pet and product role's photos are turned
 * into one clean reference picture by an image model. This costs extra
 * credits (`breakdown.references` in the estimate), charged when it runs, even
 * if the video then fails; it adds about a minute, falls back to your own
 * photos if it fails, and is turned off with `prepareReferences: false`.
 * Locations are not prepared.
 *
 * Engines: a run is made on Nodaro Motion Prism (`engine` left out, or
 * `"motion-prism"`) or Nodaro Motion Pulse (`"motion-pulse"`). Pulse renders 720p
 * (its default) or 1080p and has no draft; it makes a new take guided by the
 * clip and pictures, so its Full Quality is a new take at 1080p rather than
 * the same take re-rendered (`CastSwapFullQualityEstimate.kind`).
 *
 * How the clip is prepared for the video model (for one, whether faces are
 * hidden first, and whether a refused clip is retried) is set by Nodaro for
 * each engine; a run cannot change it. `faceMasking` is no longer read
 * (deprecated: accepted and ignored).
 *
 * Cloud edition only: `/v1/cast-swap` is served by the cloud plugin and 404s
 * on self-hosted installs. `run()` answers 202 with a job id; follow it with
 * `client.jobs.get(jobId)` / `client.jobs.getStatus(jobId)` like any other job.
 *
 * Repeats: pass `{ idempotencyKey }` to `run()` and it is sent as the
 * `Idempotency-Key` header. A repeat with the same key within the credit
 * guard's dedup window (about 10 s) answers 200 `{ jobId, deduped: true }` with
 * an `X-Dedup-Hit` header; a later one answers 202 with the first run's
 * `jobId`. Nothing new is started or charged.
 *
 * Refusals (thrown as a `NodaroError` subclass; body `{ error: { code, message } }`), before
 * anything is charged: 400 `validation_error` (the body: no role with images,
 * no reference and no `prePrompt` or `postPrompt`, more roles of a kind
 * than allowed, more than 30 images in all, `draft: true` above 480p, a
 * `prePrompt` or `postPrompt` over 4,000 characters); on Nodaro Motion Pulse,
 * `draft_unsupported` (`draft: true`), `resolution_unsupported` (480p),
 * `output_format_unsupported` (a MOV edit output) and `too_many_images` (more
 * than 10 images in the run, across every role and fixed reference);
 * `raw_reference_token` (also in a reference's `line`),
 * `invalid_role_mention` (also any `{role:N}` in a reference's `line`),
 * `unsafe_url`, `video_unreadable`, `clip_out_of_range` (4–30 s),
 * `preview_out_of_range`, `no_roles_in_preview` (a preview with every role
 * `inPreview: false`, always refused even with a prompt, or with no role kept
 * in it that has images and no `prePrompt` or `postPrompt`), `prompt_too_long`
 * (the prompt would build too long: a `{role:N}` reads as the role's name when
 * it sends no images; Nodaro Motion Pulse's cap is 8,000 characters); 401; 402 `insufficient_credits` (`run()` only); 404
 * (a `sessionId` you may not use, `run()` only); 422 `job_blocked` (`run()`
 * only); 503 `host_too_old` (both); 503 `estimate_unavailable` (`estimate()`
 * only).
 */

/**
 * The engine a Nodaro Motion run is made on, by its public id. Left out =
 * `"motion-prism"`.
 *
 * - `"motion-prism"` (Nodaro Motion Prism): 480p (the default, a draft unless
 *   `draft: false`), 720p or 1080p; Full Quality re-renders a draft's own take
 *   at 1080p.
 * - `"motion-pulse"` (Nodaro Motion Pulse): 720p (the default) or 1080p, never a
 *   draft (`draft: true` answers 400 `draft_unsupported`); Full Quality makes a
 *   new take at 1080p from a completed 720p run's inputs. A preview is still
 *   4 s from `previewStart`.
 */
export type CastSwapEngine = "motion-prism" | "motion-pulse"

/**
 * The engine ids an older client sent: the earlier public ids (`"motion-pro"`
 * = `"motion-prism"`, `"motion-lite"` = `"motion-pulse"`) and the internal
 * ones (`"seedance-2-5"`, `"kling-4"`). Still accepted in a request; never
 * returned.
 * @deprecated use {@link CastSwapEngine}.
 */
export type CastSwapEngineLegacyId = "motion-pro" | "motion-lite" | "seedance-2-5" | "kling-4"

/**
 * How a run follows its clip. Left out = `"precise"`.
 *
 * - `"precise"`: follows the clip exactly.
 * - `"motion"`: follows the clip's movement and takes the looks from your
 *   photos, more freely than `"precise"`. Its price may differ from
 *   `"precise"`'s: the estimate shows the exact price.
 */
export type CastSwapStyle = "precise" | "motion"

/**
 * Where a Nodaro Motion Pulse run cuts the clip to whole seconds (Pulse renders
 * whole seconds; asked for more than the clip, it would stretch the motion):
 * - `"cut-end"` (the default): drop the fraction of a second at its end;
 * - `"cut-start"`: drop it at its start.
 */
export type CastSwapMotionLength = "cut-end" | "cut-start"

/** @deprecated use {@link CastSwapMotionLength}. */
export type CastSwapKlingLength = CastSwapMotionLength

/** Whether a swapped subject takes this trait from the references (`"new"`) or keeps the video's (`"original"`). */
export type CastSwapTraitSource = "new" | "original"

/**
 * Preview-only settings, on every role kind; a full run (`preview` not `true`)
 * ignores both.
 */
export interface CastSwapRolePreviewSettings {
  /** The name used instead of `name` in a preview. Same rules as `name` (1–200 characters). */
  previewName?: string
  /**
   * `false` leaves this role out of the preview: its reference images are not
   * sent, not prepared and not charged, and a `{role:N}` naming it reads as its
   * `previewName`, else its `name`. Default `true`. A preview with every role
   * left out (always refused, even with a prompt), or with no role kept in it
   * that has images and no pre / post prompt, answers 400 `no_roles_in_preview`.
   */
  inPreview?: boolean
}

/** A person in the video to recast. */
export interface CastSwapPersonRole extends CastSwapRolePreviewSettings {
  kind: "person"
  /** How the person is told apart in the video, e.g. `"the woman that attacks"`. */
  name: string
  /** 0–3 images of ONE person. Empty or `null` keeps the original person. */
  images: string[] | null
  /** Body from the references or the video. Default `"new"`. */
  body?: CastSwapTraitSource
  /** Outfit from the references or the video. Default `"new"`. */
  outfit?: CastSwapTraitSource
  /** Hairstyle and haircut from the references or the video. Default `"new"`. */
  hair?: CastSwapTraitSource
}

/** The place the video happens in. */
export interface CastSwapLocationRole extends CastSwapRolePreviewSettings {
  kind: "location"
  /** How the place is named. Default `"the setting"`. */
  name?: string
  /** 0–3 images of ONE place. Empty or `null` keeps the original place. */
  images: string[] | null
}

/** An animal in the video to recast. */
export interface CastSwapPetRole extends CastSwapRolePreviewSettings {
  kind: "pet"
  /** How the animal is told apart in the video, e.g. `"the dog"`. */
  name: string
  /** 0–3 images of ONE animal. Empty or `null` keeps the original animal. */
  images: string[] | null
  /** Body (shape, size and build) from the references or the video. Default `"new"`. */
  body?: CastSwapTraitSource
  /** Coat (fur, colors and markings) from the references or the video. Default `"new"`. */
  coat?: CastSwapTraitSource
}

/** An object in the video to recast. */
export interface CastSwapProductRole extends CastSwapRolePreviewSettings {
  kind: "product"
  /** How the object is told apart in the video, e.g. `"the can"`. */
  name: string
  /** 0–3 images of ONE product. Empty or `null` keeps the original object. */
  images: string[] | null
  /** Shape and proportions from the references or the video. Default `"new"`. */
  shape?: CastSwapTraitSource
  /** Finish (colors, materials, label and markings) from the references or the video. Default `"new"`. */
  finish?: CastSwapTraitSource
}

export type CastSwapRole = CastSwapPersonRole | CastSwapLocationRole | CastSwapPetRole | CastSwapProductRole

/**
 * A fixed reference: 1–3 images of ONE thing that no role replaces, and the
 * line that says what it is (`"the glass she drinks from"`). Sent as given,
 * never prepared; its images count toward the 30.
 */
export interface CastSwapReference {
  /** 1–3 http(s) image URLs of one thing. */
  images: string[]
  /**
   * What it is, 1–500 characters. `{image}` in the line stands for this
   * reference's first image (`"Use {image} for the sky"`); a line without it
   * gets it appended. A `{role:N}` or a raw `{image:` / `{video:` / `{audio:`
   * token answers 400.
   */
  line: string
}

/**
 * @deprecated Nodaro sets this per engine; a run's `faceMasking` is ignored.
 */
export interface CastSwapFaceMaskingZone {
  leftPct?: number
  rightPct?: number
  topPct?: number
  bottomPct?: number
}

/**
 * @deprecated Nodaro sets how the clip is prepared for the video model, per
 * engine; a run cannot change it. A `faceMasking` sent is accepted and
 * ignored (no error), so older code keeps working unchanged.
 */
export interface CastSwapFaceMasking {
  mode: "off" | "always" | "auto"
  fill?: "blur" | "depth"
  minFaceHeightPct?: number
  maxFaceHeightPct?: number
  zone?: CastSwapFaceMaskingZone | null
  blurStrengthPct?: number
  threshold?: number
}

/** The body of `POST /v1/cast-swap` and `POST /v1/cast-swap/estimate`. */
export interface CastSwapParams {
  /** The source clip, 4–30 seconds. */
  videoUrl: string
  /**
   * Who and what to swap: at most 6 person roles, 1 location role, 3 pet roles
   * and 3 product roles, with at most 30 images in all. A role with no images
   * is skipped (that subject or place stays as in the video). At least one role
   * with images, or a `prePrompt` or `postPrompt`, is required.
   */
  roles: CastSwapRole[]
  /**
   * Fixed references (at most 5): things the video should show that no role
   * replaces, each with the line that names it. Their images count toward the
   * 30. A reference alone is enough for a run (no role needs images).
   */
  references?: CastSwapReference[]
  /**
   * Your own words placed at the start of the prompt, before the role
   * instructions; at most 4,000 characters. Mention a role as `{role:N}`, as in
   * `postPrompt`; the same 400 refusals apply (an N outside 1..`roles.length`,
   * a raw `{image:` / `{video:` / `{audio:` token).
   */
  prePrompt?: string
  /**
   * Extra instructions in your own words, at most 4,000 characters. Mention a
   * role as `{role:N}`, where N is its 1-based position in `roles`
   * (`{role:1}` is `roles[0]`; empty roles count).
   *
   * The route answers 400, before charging, for an N outside 1..`roles.length`,
   * for a raw `{image:` / `{video:` / `{audio:` token in the pre or post prompt
   * or a role's `name`, for a clip outside 4–30 s, and for a preview past the clip's
   * end (`previewStart + 4` > its length).
   */
  postPrompt?: string
  /** `true` runs on 4 seconds of the clip, starting at `previewStart`: a cheap check of the roles and choices. */
  preview?: boolean
  /** Where the preview starts, in seconds. Default 0. */
  previewStart?: number
  /**
   * The engine (see {@link CastSwapEngine}). Default `"motion-prism"`. The job
   * records it in `input_data.engine`, and a completed job's output in its
   * `engine`. The ids an older client sent ({@link CastSwapEngineLegacyId})
   * are still accepted.
   */
  engine?: CastSwapEngine | CastSwapEngineLegacyId
  /**
   * How the run follows the clip (see {@link CastSwapStyle}). Default
   * `"precise"`; the job records it in `input_data.style`.
   */
  style?: CastSwapStyle
  /**
   * Flex only (`style: "motion"`, a direct run): an art style that restyles
   * the whole video, as a `direction.style` id of the platform's `style`
   * picker catalog (the same ids an image's `direction.style` takes); the
   * platform words it. Refused with 400 `unknown_art_style` (not in the
   * catalog), `art_style_not_supported` (a saved moodboard, `moodboard:…`)
   * or `art_style_needs_flex` (Precise, a trend run). It never changes the
   * price. The job records it in `input_data.direction`.
   */
  direction?: { style: string }
  /**
   * Nodaro Motion Pulse only (Prism ignores it): which end of the clip is cut to
   * whole seconds (see {@link CastSwapMotionLength}). Default `"cut-end"`.
   */
  motionLength?: CastSwapMotionLength
  /** @deprecated use {@link motionLength} (still accepted). */
  klingLength?: CastSwapKlingLength
  /**
   * The output resolution. Nodaro Motion Prism: `"480p"` (default), `"720p"` or
   * `"1080p"`. Nodaro Motion Pulse: `"720p"` (default) or `"1080p"`; `"480p"`
   * answers 400.
   */
  resolution?: "480p" | "720p" | "1080p"
  /**
   * Render as a draft (Nodaro Motion Prism only). Defaults to `true` at 480p and
   * `false` above it; `true` with `"720p"` or `"1080p"` answers 400 (draft is
   * 480p only). Nodaro Motion Pulse has no draft: `true` answers 400
   * `draft_unsupported`.
   */
  draft?: boolean
  /**
   * Turn each person, pet and product role's photos into one clean reference
   * picture before the video (extra credits, shown in `breakdown.references`;
   * about a minute longer; falls back to your own photos if it fails).
   * Default `true`.
   */
  prepareReferences?: boolean
  /**
   * Ignored: Nodaro sets how the clip is prepared, per engine. Accepted (no
   * error) so older code keeps working.
   * @deprecated leave it out.
   */
  faceMasking?: CastSwapFaceMasking
  /**
   * `"draft"` means 480p draft.
   * @deprecated use `resolution` + `draft`.
   */
  quality?: "draft"
  /** A generation session to file the result in. */
  sessionId?: string
  /** The client app that sent the run (stored on the job as `input_data.origin`). */
  origin?: string
}

/** What a run would cost, in credits. */
export interface CastSwapEstimate {
  /**
   * The engine the run would use, by its public id (absent from an older
   * server = `"motion-prism"`). An id an older server answers is read as the
   * public id it names.
   */
  engine?: CastSwapEngine
  /**
   * What is held when the run starts. The run is charged what it actually
   * costs, which is expected to be `expectedCredits`.
   */
  totalCredits: number
  /**
   * The charge the run is expected to come to. Never above `totalCredits`
   * (on Nodaro Motion Pulse it equals it: Pulse renders exactly the length
   * asked for, so the hold is what it settles at). Absent from an older
   * server: read `totalCredits` then.
   */
  expectedCredits?: number
  /**
   * The parts of the quote, by name, for display only:
   * - `base`: the run itself (its base fee). A server before Cast Swap 0.396.0
   *   names it `castSwap` instead: read `base`, else `castSwap`;
   * - `references`: preparing the reference pictures (0 when
   *   `prepareReferences` is off or there is nothing to prepare);
   * - `motion`: what the video holds (on Nodaro Motion Pulse, what it costs);
   * - `motionExpected`: what the video is expected to be charged, never above
   *   `motion` (Nodaro Motion Prism);
   * - `privacy`: preparing the clip, when the engine's setting does. In both
   *   totals when it always runs; outside both when it is the retry
   *   (`privacyCredits`).
   *
   * `motion` and `motionExpected` are alternatives, so the parts sum to more
   * than either total: read `totalCredits` and `expectedCredits`, never the
   * sum. Other parts may appear.
   */
  breakdown: {
    base?: number
    /** @deprecated read {@link base} (an older server answered this name for the same part). */
    castSwap?: number
    references: number
    motion?: number
    motionExpected?: number
    privacy?: number
  } & Record<string, number>
  /**
   * The extra credits charged only if the video model refuses the clip and
   * the run is retried (Nodaro's setting for the engine decides whether it
   * does). Not in `totalCredits` or `expectedCredits`; `run()` needs credits
   * for both the hold and this (else 402).
   */
  privacyCredits?: number
  /** @deprecated read {@link privacyCredits} (an older server answered this name). */
  maskingCredits?: number
  /**
   * `true` when the video is made at Auto length (every Nodaro Motion Prism
   * run): the final charge is expected to come out lower than `totalCredits`,
   * at about `expectedCredits`. `false` on Nodaro Motion Pulse.
   */
  settlesLower: boolean
}

/** Per-call options for {@link CastSwapResource.run}. */
export interface CastSwapRunOptions {
  /**
   * Sent as the `Idempotency-Key` header, unchanged (the SDK checks nothing;
   * an empty string sends no header, like no key).
   * The server takes 8–200 characters and answers 400 for any other length.
   * Reuse the same value when retrying the same run: within about 10 s the
   * repeat answers 200 `{ jobId, deduped: true }`, later 202 with the first
   * run's `jobId`. Nothing new is started or charged.
   */
  idempotencyKey?: string
}

/**
 * What a Full Quality version would be: `"same-take"` re-renders a Nodaro
 * Motion Prism draft's own take at 1080p; `"new-take"` makes a new Nodaro Motion Pulse take at
 * 1080p from a 720p run's inputs (it will not match the 720p run frame for
 * frame). The 720p run or draft stays either way.
 */
export type CastSwapFullQualityKind = "same-take" | "new-take"

/**
 * What a Full Quality version of a run would cost
 * (`POST /v1/cast-swap/:jobId/full-quality/estimate`): a Nodaro Motion Prism
 * draft, or a completed Nodaro Motion Pulse run at 720p.
 */
export interface CastSwapFullQualityEstimate {
  /**
   * Which Full Quality this is ({@link CastSwapFullQualityKind}), so it can
   * be worded right. Absent from an older server: `"same-take"`.
   */
  kind?: CastSwapFullQualityKind
  /** The quote in credits: `breakdown.base` plus the 1080p render (same take) or the new take. */
  totalCredits: number
  /**
   * The parts of the quote, by name, for display only: `base` (the Full
   * Quality job's own steps; a server before Cast Swap 0.396.0 names it
   * `castSwap` instead: read `base`, else `castSwap`), and `motionHd` (a same
   * take: the 1080p render, 0 when an earlier try of this draft already
   * finished that render, which is then reused) or `motion` (a new take).
   */
  breakdown: {
    base?: number
    /** @deprecated read {@link base} (an older server answered this name for the same part). */
    castSwap?: number
    motionHd?: number
    motion?: number
  } & Record<string, number>
  /** ISO time until which the run can be finished at Full Quality (7 days after it completed). */
  availableUntil: string
}

/** Options for {@link CastSwapResource.fullQuality}. */
export interface CastSwapFullQualityParams {
  /** A generation session to file the Full Quality result in. */
  sessionId?: string
}

/** The Full Quality job (`POST /v1/cast-swap/:jobId/full-quality`). */
export interface CastSwapFullQualityResult {
  jobId: string
  /** `true` when this run's Full Quality was already running or done: that job is answered, nothing new is started or charged. */
  existing?: boolean
}

/**
 * The `code` of a Full Quality refusal (`NodaroError.code`), all before
 * anything is charged:
 * - `unauthorized` (401): no authenticated user;
 * - `not_found` (404): not your job, or not a Nodaro Motion run; also a
 *   `sessionId` you may not use;
 * - `not_completed` (409): the run has not finished;
 * - `not_a_draft` (409): the run is neither a Nodaro Motion Prism draft nor a
 *   Nodaro Motion Pulse run at 720p (a Pulse run at 1080p is already Full Quality);
 * - `draft_expired` (410): more than 7 days after the draft completed, or
 *   the draft can no longer be finished at Full Quality;
 * - `full_quality_pending` (409, `details.retryable: true`): not final — an
 *   earlier try's 1080p render of this draft is being reviewed, or has not
 *   started yet; try again later (once the review ends). The only refusal
 *   that ends on its own;
 * - `full_quality_unavailable` (409): final — nothing kept to re-render, no
 *   readable completion time, or the 1080p finalize refuses this draft; on
 *   the start only, also "failed too many times" (every try failed) or no
 *   try can be started for this run;
 * - `insufficient_credits` (402), or in a workspace `budget_exceeded`,
 *   `member_cap_exceeded` or `user_allowance_exceeded`;
 * - `job_blocked` (422): the request was blocked by the job policy;
 * - `job_read_failed` (503, retryable), `estimate_unavailable` (503, try
 *   again shortly), `host_too_old` (503).
 *
 * Open-ended: a code not listed here may still arrive.
 */
export type CastSwapFullQualityRefusalCode =
  | "unauthorized"
  | "not_found"
  | "not_completed"
  | "not_a_draft"
  | "draft_expired"
  | "full_quality_pending"
  | "full_quality_unavailable"
  | "insufficient_credits"
  | "budget_exceeded"
  | "member_cap_exceeded"
  | "user_allowance_exceeded"
  | "job_blocked"
  | "job_read_failed"
  | "estimate_unavailable"
  | "host_too_old"
  | (string & {})

export class CastSwapResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * Start a Nodaro Motion run (`POST /v1/cast-swap`, 202 `{ jobId }`). Returns the
   * job to follow. With `options.idempotencyKey` (sent as the
   * `Idempotency-Key` header; 8–200 characters, else 400) a repeat with the
   * same key within about 10 s answers 200 `{ jobId, deduped: true }`, a later
   * one 202 with the first run's `jobId`; nothing new starts.
   */
  run(params: CastSwapParams, options?: CastSwapRunOptions): Promise<{ jobId: string; deduped?: boolean }> {
    return this.client.request("POST", "/v1/cast-swap", {
      body: params,
      ...(options?.idempotencyKey ? { headers: { "Idempotency-Key": options.idempotencyKey } } : {}),
    })
  }

  /** Quote a run before starting it (`POST /v1/cast-swap/estimate`); spends nothing. */
  async estimate(params: CastSwapParams): Promise<CastSwapEstimate> {
    const quote = await this.client.request<CastSwapEstimate>("POST", "/v1/cast-swap/estimate", { body: params })
    // An older server names the engine by an earlier id: answered as the public id it names.
    const engine = nodaroMotionEngineFrom(quote?.engine)
    return engine && engine !== quote.engine ? { ...quote, engine } : quote
  }

  /**
   * Quote finishing a run at Full Quality (`POST
   * /v1/cast-swap/:jobId/full-quality/estimate`); spends nothing. `jobId` is a
   * finished Nodaro Motion Prism DRAFT run, or a finished Nodaro Motion Pulse
   * run at 720p (a Nodaro Motion or trend run); the quote's `kind` says whether it is the same take
   * re-rendered or a new take. The quote
   * does not look for a Full Quality already running: when one is,
   * {@link fullQuality} answers it (`existing: true`) and charges nothing.
   * Refusals: {@link CastSwapFullQualityRefusalCode}.
   */
  fullQualityEstimate(jobId: string): Promise<CastSwapFullQualityEstimate> {
    return this.client.request("POST", `/v1/cast-swap/${encodeURIComponent(jobId)}/full-quality/estimate`, { body: {} })
  }

  /**
   * Finish a run at Full Quality (`POST /v1/cast-swap/:jobId/full-quality`):
   * at 1080p, with the clip's audio, as a new job linked to the run — a
   * Nodaro Motion Prism draft's own take re-rendered, or a new Nodaro Motion Pulse take from a
   * 720p run's inputs (the quote's `kind`). SPENDS CREDITS: quote it first with
   * {@link fullQualityEstimate}. Answers 202 `{ jobId }`, or 200
   * `{ jobId, existing: true }` when this run's Full Quality is already
   * running or done (one per run; a failed one may be asked again). Follow
   * the job with `client.jobs.get(jobId)`. No `Idempotency-Key` is taken: the
   * server keys the job by the draft. The new job keeps the draft's origin.
   * Refusals: {@link CastSwapFullQualityRefusalCode}.
   */
  fullQuality(jobId: string, params: CastSwapFullQualityParams = {}): Promise<CastSwapFullQualityResult> {
    const body = params.sessionId !== undefined ? { sessionId: params.sessionId } : {}
    return this.client.request("POST", `/v1/cast-swap/${encodeURIComponent(jobId)}/full-quality`, { body })
  }
}
