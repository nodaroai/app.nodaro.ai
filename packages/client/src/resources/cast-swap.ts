import type { NodaroClientCore } from "../core.js"

/**
 * Cast Swap — replace the people, pets, products and/or the location in a
 * short video with your own references, keeping its motion, framing, timing
 * and sound (the clip's audio is kept, and the result is the clip's length).
 *
 * Before the video, each person, pet and product role's photos are turned
 * into one clean reference picture by an image model. This costs extra
 * credits (`breakdown.references` in the estimate), charged when it runs, even
 * if the video then fails; it adds about a minute, falls back to your own
 * photos if it fails, and is turned off with `prepareReferences: false`.
 * Locations are not prepared.
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
 * anything is charged: 400 `validation_error` (the body: no role with images
 * and no `prePrompt` or `postPrompt`, more roles of a kind
 * than allowed, more than 30 images in all, `draft: true` above 480p, a
 * `prePrompt` or `postPrompt` over 4,000 characters, a `faceMasking` setting
 * out of range), `raw_reference_token`, `invalid_role_mention`,
 * `unsafe_url`, `video_unreadable`, `clip_out_of_range` (4–30 s),
 * `preview_out_of_range`, `no_roles_in_preview` (a preview with every role
 * `inPreview: false`, always refused even with a prompt, or with no role kept
 * in it that has images and no `prePrompt` or `postPrompt`), `prompt_too_long`
 * (the prompt would build too long: a `{role:N}` reads as the role's name when
 * it sends no images); 401; 402 `insufficient_credits` (`run()` only); 404
 * (a `sessionId` you may not use, `run()` only); 422 `job_blocked` (`run()`
 * only); 503 `host_too_old` (both); 503 `estimate_unavailable` (`estimate()`
 * only).
 */

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
 * Margins of the frame, each 0–49 % (default 0): a face whose centre lies in a
 * margin is not masked, so only faces inside the inner rectangle are.
 */
export interface CastSwapFaceMaskingZone {
  /** % of the frame's width from the left edge. Default 0. */
  leftPct?: number
  /** % of the frame's width from the right edge. Default 0. */
  rightPct?: number
  /** % of the frame's height from the top edge. Default 0. */
  topPct?: number
  /** % of the frame's height from the bottom edge. Default 0. */
  bottomPct?: number
}

/**
 * Face masking: the faces in the source clip are covered before the video
 * model sees it, keeping their movement and lip timing while the rest of the
 * clip is sent as it is.
 *
 * - `"off"` (the same as leaving `faceMasking` out): the clip is sent as it is.
 * - `"always"`: the faces are masked before the first attempt. Its credits are
 *   in the quote (`breakdown.masking`, counted in `totalCredits`).
 * - `"auto"`: the run starts unmasked; only if the video model refuses the
 *   source clip is it retried once with the faces masked. Any other failure is
 *   not retried. The extra credits, charged only when that retry runs, are the
 *   estimate's `maskingCredits` (not in `totalCredits`).
 *
 * A completed job's output carries `faceMasking: { applied, reason }`:
 * `applied` is whether the video was made from the masked clip, and `reason`
 * is `"always"` (masked before the first attempt), `"input_refused"` (`auto`
 * retried after the source clip was refused), `"no_faces"` (no face was left
 * to mask after the filters: an `always` run continues unmasked; an `auto`
 * run fails with the original refusal instead) or `"off"`.
 */
export interface CastSwapFaceMasking {
  mode: "off" | "always" | "auto"
  /** What covers a masked face: `"blur"` (default) or `"depth"` (a depth-color view of it). */
  fill?: "blur" | "depth"
  /** Mask only faces at least this % of the frame's height, 0–100. Default 15. */
  minFaceHeightPct?: number
  /**
   * Mask only faces at most this % of the frame's height, 0–100. Default 0 (no
   * limit). When above 0 it must be at least `minFaceHeightPct` (else 400).
   */
  maxFaceHeightPct?: number
  /** Leave out faces near the edges of the frame. Default: no margins. */
  zone?: CastSwapFaceMaskingZone
  /** The blur's strength, 0.1–5 % of the frame's width (`fill: "blur"`). Default 2. */
  blurStrengthPct?: number
  /** How sure the face finder must be, 0.05–0.95: lower finds more faces. Default 0.5. */
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
  /** The output resolution. Default `"480p"`. */
  resolution?: "480p" | "720p" | "1080p"
  /**
   * Render as a draft. Defaults to `true` at 480p and `false` above it; `true`
   * with `"720p"` or `"1080p"` answers 400 (draft is 480p only).
   */
  draft?: boolean
  /**
   * Turn each person, pet and product role's photos into one clean reference
   * picture before the video (extra credits, shown in `breakdown.references`;
   * about a minute longer; falls back to your own photos if it fails).
   * Default `true`.
   */
  prepareReferences?: boolean
  /** Mask the faces in the source clip (see {@link CastSwapFaceMasking}). Default: off. */
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
   * The quote in credits: `breakdown.castSwap + breakdown.seedance +
   * breakdown.references`, plus `breakdown.masking` with face masking
   * `"always"`.
   */
  totalCredits: number
  /**
   * `castSwap`: the run itself; `seedance`: the video model it calls;
   * `references`: preparing the reference pictures (0 when `prepareReferences`
   * is off or there is nothing to prepare); `masking`: masking the faces,
   * present only when `faceMasking` is on. With `"auto"` it equals
   * `maskingCredits` and is not added to `totalCredits`.
   */
  breakdown: { castSwap: number; seedance: number; references: number; masking?: number }
  /**
   * Face masking `"auto"` only: the extra credits charged if the source clip
   * is refused and the run is retried with the faces masked. Not in
   * `totalCredits`; `run()` needs credits for both (else 402).
   */
  maskingCredits?: number
  /** `true` when the video is made at Auto length: the final charge is expected to come out lower than this quote. */
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

export class CastSwapResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * Start a Cast Swap run (`POST /v1/cast-swap`, 202 `{ jobId }`). Returns the
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
  estimate(params: CastSwapParams): Promise<CastSwapEstimate> {
    return this.client.request("POST", "/v1/cast-swap/estimate", { body: params })
  }
}
