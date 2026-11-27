import { nodaroMotionEngineFrom, videoRemakeFlashEngineFrom } from "@nodaro/shared/models"
import type { NodaroClientCore } from "../core.js"

/**
 * Video Remake (the `videoRemake` resource; routes `/v1/video-remake`) — replace
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
 * Engines: a run is made on Nodaro Prism (`engine` left out, or
 * `"nodaro-prism"`) or Nodaro Pulse (`"nodaro-pulse"`). Prism renders
 * 480p (the default; plain unless `draft: true`), 720p or 1080p. Pulse renders
 * 720p (its default) or 1080p and makes a new take guided by the clip and
 * pictures; it has no draft, so no Full Quality: run it again at 1080p instead.
 *
 * How the clip is prepared for the video model (for one, whether faces are
 * hidden first, and whether a refused clip is retried) is set by Nodaro for
 * each engine; a run cannot change it. `faceMasking` is no longer read
 * (deprecated: accepted and ignored).
 *
 * Cloud edition only: `/v1/video-remake` is served by the cloud plugin and 404s
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
 * no reference, no `prePrompt` or `postPrompt` and no art style (Flex on
 * Nodaro Prism), more than 15 roles in all, more than 30 images sent in all
 * (a role whose pictures are prepared sends one), `draft: true` above 480p, a
 * `prePrompt` or `postPrompt` over 4,000 characters); `place_roles_need_names`
 * (two place roles with the same name: an unnamed place is "the setting");
 * `resolution_not_offered` (a `resolution` the engine choice does not offer
 * here; the error's `details.offered` lists the sizes it does, see
 * {@link VideoRemakeResolution}); on Nodaro Pulse,
 * `draft_unsupported` (`draft: true`), `resolution_unsupported` (480p, where
 * the engine does not deliver resolutions yet),
 * `output_format_unsupported` (a MOV edit output) and `too_many_images` (more
 * than 10 images in the run, across every role and fixed reference);
 * `raw_reference_token` (also in a reference's `line`),
 * `invalid_role_mention` (also any `{role:N}` in a reference's `line`),
 * `unsafe_url`, `video_unreadable`, `clip_out_of_range` (4–30 s; 2–30 s
 * where `styleChoice()` answers `shortClips` true),
 * `preview_out_of_range`, with a part of the clip `portion_unavailable`,
 * `portion_incomplete`, `portion_with_preview`, `portion_not_for_trends`,
 * `portion_out_of_range`, `source_too_long` and `long_source_unpriceable`
 * (see `portionStart`), `unnamed_role_needs_picture` (a role with no name
 * and no image), `no_roles_in_preview` (a preview that would change nothing,
 * judged on what it sends: no role kept in it with images, no fixed
 * reference, no `prePrompt` or `postPrompt` and no art style), `prompt_too_long`
 * (the prompt would build too long: a `{role:N}` reads as the role's name when
 * it sends no images; Nodaro Pulse's cap is 8,000 characters); 401; 402 `insufficient_credits` (`run()` only); 404
 * (a `sessionId` you may not use, `run()` only); 422 `job_blocked` (`run()`
 * only); 503 `host_too_old` (both); 503 `estimate_unavailable` (`estimate()`
 * only); 409 `resolution_unavailable` (a size the engine choice offers that
 * this request cannot have: try a smaller one). A Flash choice ({@link VideoRemakeFlashEngine}) adds 409
 * `flash_not_offered` (not offered here) and 400
 * `flash_model_unsupported` (what it cannot take: a draft, Nodaro Prism
 * Flash's 10 images, Nodaro Pulse Flash's 20 seconds).
 */

/**
 * The engine a Video Remake run is made on, by its public id. Left out =
 * `"nodaro-prism"`.
 *
 * - `"nodaro-prism"` (Nodaro Prism): delivered at 720p (the default), 1080p
 *   or 4K (see {@link VideoRemakeResolution}); `draft: true` makes a 480p
 *   draft, whose own take Full Quality finishes at 1080p.
 * - `"nodaro-pulse"` (Nodaro Pulse): delivered at 720p (the default), 1080p or
 *   4K, never a draft (`draft: true` answers 400 `draft_unsupported`), so no
 *   Full Quality: run it again at a larger size instead. A preview is still 4 s
 *   from `previewStart`.
 */
export type VideoRemakeEngine = "nodaro-prism" | "nodaro-pulse"

/**
 * A Flash choice: an engine's run on the faster, lower-cost model of the same
 * family, at that model's own price (the estimate shows it). Offered only
 * where {@link VideoRemakeResource.styleChoice} answers `flash` true for the
 * engine; anywhere else a run or estimate naming one is refused 409
 * `flash_not_offered`. A trend may be made on one too.
 *
 * - `"nodaro-prism-flash"` (Nodaro Prism Flash, a Nodaro Prism run): delivered
 *   at 720p (the default) or 1080p; no draft and no Full Quality; at most 10
 *   images per run.
 * - `"nodaro-pulse-flash"` (Nodaro Pulse Flash, a Nodaro Pulse run): delivered
 *   at 720p (the default) or 1080p; no draft and no Full Quality; at most 20
 *   seconds of output, and 20 seconds of reference video in all.
 *
 * What a Flash choice cannot take is refused 400 `flash_model_unsupported`,
 * before anything is held. The job records the choice in `input_data.engine`,
 * and a completed job's output in its `engine`.
 */
export type VideoRemakeFlashEngine = "nodaro-prism-flash" | "nodaro-pulse-flash"

/** What a run may name as its `engine`: an engine, or (where offered) its Flash choice. */
export type VideoRemakeEngineChoice = VideoRemakeEngine | VideoRemakeFlashEngine

/**
 * The engine ids an older client sent: the earlier public ids
 * (`"motion-prism"` and `"motion-pro"` = `"nodaro-prism"`, `"motion-pulse"`
 * and `"motion-lite"` = `"nodaro-pulse"`) and the internal ones
 * (`"seedance-2-5"`, `"kling-4"`). Still accepted in a request; never
 * returned.
 * @deprecated use {@link VideoRemakeEngine}.
 */
export type VideoRemakeEngineLegacyId = "motion-prism" | "motion-pulse" | "motion-pro" | "motion-lite" | "seedance-2-5" | "kling-4"

/**
 * How a run follows its clip. Left out = `"precise"`.
 *
 * - `"precise"`: follows the clip exactly.
 * - `"motion"`: follows the clip's movement and takes the looks from your
 *   photos, more freely than `"precise"`. Its price may differ from
 *   `"precise"`'s: the estimate shows the exact price.
 */
export type VideoRemakeStyle = "precise" | "motion"

/**
 * Where a Nodaro Pulse run cuts the clip to whole seconds (Pulse renders
 * whole seconds; asked for more than the clip, it would stretch the motion):
 * - `"cut-end"` (the default): drop the fraction of a second at its end;
 * - `"cut-start"`: drop it at its start.
 */
export type VideoRemakeMotionLength = "cut-end" | "cut-start"


/** Whether a swapped subject takes this trait from the references (`"new"`) or keeps the video's (`"original"`). */
export type VideoRemakeTraitSource = "new" | "original"

/**
 * Preview-only settings, on every role kind; a full run (`preview` not `true`)
 * ignores both.
 */
export interface VideoRemakeRolePreviewSettings {
  /** The name used instead of `name` in a preview. Same rules as `name` (1–200 characters). */
  previewName?: string
  /**
   * `false` leaves this role out of the preview: its reference images are not
   * sent, not prepared and not charged, and a `{role:N}` naming it reads as its
   * `previewName`, else its `name`. Default `true`. A preview that would
   * change nothing (no role kept in it with images, no fixed reference, no pre
   * or post prompt and no art style) answers 400 `no_roles_in_preview`.
   */
  inPreview?: boolean
}

/**
 * What a role is on a run whose clip is a 3D previz (`clipKind: "previz"`), on
 * every role kind; any other run ignores it.
 */
export interface VideoRemakeRolePrevizSettings {
  /**
   * What the role's model BECOMES in the video to make, in your own words
   * (1–200 characters). On a previz run the role's `name` is the LOCATOR of
   * its model in the clip (its colour, or its shape and position: `"the pink
   * model"`), and `subject` is what the result's script calls it. Write the
   * finished thing, not the previz model, and leave out the model's colour
   * unless the real thing has it: `"a jockey on a bay racehorse"`, not
   * `"the driver of the red car"`. Left out: the script calls it by its
   * picture.
   */
  subject?: string
}

/** A person in the video to recast. */
export interface VideoRemakePersonRole extends VideoRemakeRolePreviewSettings, VideoRemakeRolePrevizSettings {
  kind: "person"
  /** How the person is told apart in the video, e.g. `"the woman that attacks"`.
   *
   * Direct runs only: omit it (or leave it empty) and the role is named by its
   * first picture — matched to the subject in the video it fits best; such a
   * role needs at least one image (else 400 `unnamed_role_needs_picture`). A
   * trend run's roles are always named (400 `role_name_required`).
   */
  name?: string
  /** 0–3 images of ONE person. Empty or `null` keeps the original person. */
  images: string[] | null
  /** Body from the references or the video. Default `"new"`. */
  body?: VideoRemakeTraitSource
  /** Outfit from the references or the video. Default `"new"`. */
  outfit?: VideoRemakeTraitSource
  /** Hairstyle and haircut from the references or the video. Default `"new"`. */
  hair?: VideoRemakeTraitSource
  /**
   * Face: from the picture (`"new"`, the default) or from the video
   * (`"original"`). From the video keeps the person's own face; use it to
   * change only clothes, hair or build. Only where
   * {@link VideoRemakeResource.styleChoice} answers `roleFace` true; elsewhere
   * `"original"` is refused 409 `engine_unsupported`.
   */
  face?: VideoRemakeTraitSource
}

/** The place the video happens in. */
export interface VideoRemakeLocationRole extends VideoRemakeRolePreviewSettings, VideoRemakeRolePrevizSettings {
  kind: "location"
  /** How the place is named. Default `"the setting"`. */
  name?: string
  /** 0–3 images of ONE place. Empty or `null` keeps the original place. */
  images: string[] | null
}

/** An animal in the video to recast. */
export interface VideoRemakePetRole extends VideoRemakeRolePreviewSettings, VideoRemakeRolePrevizSettings {
  kind: "pet"
  /** How the animal is told apart in the video, e.g. `"the dog"`.
   *
   * Direct runs only: omit it (or leave it empty) and the role is named by its
   * first picture — matched to the subject in the video it fits best; such a
   * role needs at least one image (else 400 `unnamed_role_needs_picture`). A
   * trend run's roles are always named (400 `role_name_required`).
   */
  name?: string
  /** 0–3 images of ONE animal. Empty or `null` keeps the original animal. */
  images: string[] | null
  /** Body (shape, size and build) from the references or the video. Default `"new"`. */
  body?: VideoRemakeTraitSource
  /** Coat (fur, colors and markings) from the references or the video. Default `"new"`. */
  coat?: VideoRemakeTraitSource
}

/** An object in the video to recast. */
export interface VideoRemakeProductRole extends VideoRemakeRolePreviewSettings, VideoRemakeRolePrevizSettings {
  kind: "product"
  /** How the object is told apart in the video, e.g. `"the can"`.
   *
   * Direct runs only: omit it (or leave it empty) and the role is named by its
   * first picture — matched to the subject in the video it fits best; such a
   * role needs at least one image (else 400 `unnamed_role_needs_picture`). A
   * trend run's roles are always named (400 `role_name_required`).
   */
  name?: string
  /** 0–3 images of ONE product. Empty or `null` keeps the original object. */
  images: string[] | null
  /** Shape and proportions from the references or the video. Default `"new"`. */
  shape?: VideoRemakeTraitSource
  /** Finish (colors, materials, label and markings) from the references or the video. Default `"new"`. */
  finish?: VideoRemakeTraitSource
}

export type VideoRemakeRole = VideoRemakePersonRole | VideoRemakeLocationRole | VideoRemakePetRole | VideoRemakeProductRole

/**
 * A fixed reference: 1–3 images of ONE thing that no role replaces, and the
 * line that says what it is (`"the glass she drinks from"`). Sent as given,
 * never prepared; its images count toward the 30.
 */
export interface VideoRemakeReference {
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
export interface VideoRemakeFaceMaskingZone {
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
export interface VideoRemakeFaceMasking {
  mode: "off" | "always" | "auto"
  fill?: "blur" | "depth"
  minFaceHeightPct?: number
  maxFaceHeightPct?: number
  zone?: VideoRemakeFaceMaskingZone | null
  blurStrengthPct?: number
  threshold?: number
}

/** The body of `POST /v1/video-remake` and `POST /v1/video-remake/estimate`. */
export interface VideoRemakeParams {
  /**
   * The source clip, 4–30 seconds. Where {@link VideoRemakeStyleChoice.shortClips}
   * is `true`, 2–30 seconds. With a part ({@link portionStart} and
   * {@link portionSec}) or a 4 s `preview`, where
   * {@link VideoRemakeStyleChoice.portion} is `true`, the source may be longer
   * than 30 s, up to 10 minutes.
   */
  videoUrl: string
  /**
   * Who and what to swap: at most 15 roles in all, in any mix of person,
   * pet, product and location roles. More than one location role is allowed:
   * each names a different setting of the video, so give each its own `name`
   * (two with the same name, or two left unnamed, are refused with
   * `place_roles_need_names`). A run sends at most 30 images in all: with
   * `prepareReferences` on, a person, pet or product role sends ONE prepared
   * picture whatever the number given; a location role, and every role with
   * it off, sends its pictures as given; each fixed reference's count too. On
   * Nodaro Pulse a run sends at most 10. If a role's picture cannot be
   * prepared, its own pictures are sent instead, and a run that this takes
   * past the engine's limit fails with `too_many_images_prism` (on Nodaro
   * Pulse, `too_many_images`): the run's own fee
   * is refunded, and the pictures already prepared stay charged. A
   * trend's run keeps its trend's own slots. A role with no images
   * is skipped (that subject or place stays as in the video). At least one role
   * with images, a fixed reference, a `prePrompt` or `postPrompt`, or an art
   * style (`direction`, Flex on Nodaro Prism) is required. With an art
   * style and nothing to swap, a run restyles the whole clip (see `direction`).
   */
  roles: VideoRemakeRole[]
  /**
   * Fixed references (at most 5): things the video should show that no role
   * replaces, each with the line that names it. Their images count toward the
   * 30. A reference alone is enough for a run (no role needs images).
   */
  references?: VideoRemakeReference[]
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
   * or a role's `name`, for a clip outside 4–30 s (2–30 s where
   * {@link VideoRemakeStyleChoice.shortClips} is `true`), and for a preview past the clip's
   * end (`previewStart + 4` > its length).
   */
  postPrompt?: string
  /** `true` runs on 4 seconds of the clip, starting at `previewStart`: a cheap check of the roles and choices. */
  preview?: boolean
  /** Where the preview starts, in seconds. Default 0. */
  previewStart?: number
  /**
   * Run a part of the clip: where it starts, in seconds (at least 0). Send
   * it with {@link portionSec}. The run is an ordinary run of that part (not
   * a preview), priced by its length, and its completed output's
   * `durationSec` is the part's length; the job records both fields in its
   * `input_data`. Only where {@link VideoRemakeStyleChoice.portion} is
   * `true`; elsewhere 400 `portion_unavailable`. Refused, each 400:
   * `portion_incomplete` (one field without the other),
   * `portion_with_preview` (with `preview: true`), `portion_not_for_trends`
   * (a trend run), `portion_out_of_range` (the part does not fit the clip, or
   * its length is outside a run's limits), `source_too_long` (a source over
   * 10 minutes) and `long_source_unpriceable` (a source over 30 s whose
   * length could not be read to price the part).
   */
  portionStart?: number
  /** The part's length in seconds, with {@link portionStart}. */
  portionSec?: number
  /**
   * The engine (see {@link VideoRemakeEngine}), or where it is offered its
   * Flash choice (see {@link VideoRemakeFlashEngine}). Default
   * `"nodaro-prism"`. The job records it in `input_data.engine`, and a
   * completed job's output in its `engine`. The ids an older client sent
   * ({@link VideoRemakeEngineLegacyId}) are still accepted.
   */
  engine?: VideoRemakeEngineChoice | VideoRemakeEngineLegacyId
  /**
   * How the run follows the clip (see {@link VideoRemakeStyle}). Default
   * `"precise"`; the job records it in `input_data.style`.
   */
  style?: VideoRemakeStyle
  /**
   * A direct run on Nodaro Prism: an art style that restyles the whole
   * video, as a `direction.style` id of the platform's `style` picker catalog
   * (the same ids an image's `direction.style` takes); the platform words it.
   * A Flex run (`style: "motion"`) takes one, and so does a Precise run where
   * {@link VideoRemakeResource.styleChoice} answers `preciseArtStyle` true for the
   * engine. Nodaro may make such a Precise request the way a Flex run is made
   * (its engine does by default, unless Nodaro turns that off): its estimate,
   * price and Full Quality are then a Flex run's, while the job still records
   * the style sent (`input_data.style` absent, or `"precise"`; jobs made so
   * before the style was kept record `"motion"`). Otherwise it is Precise's edit
   * of the clip, drawn in the art style. Refused with
   * 400 `unknown_art_style` (not in the catalog), `art_style_not_supported` (a
   * saved moodboard, `moodboard:…`) or `art_style_needs_flex` (a trend run, a
   * Flex run whose prompt is made Precise by Nodaro's setting for how Flex
   * runs are prepared, or a Precise request on an engine from before Precise
   * runs took one), and on Nodaro Pulse with `art_style_needs_prism`.
   * The estimate (sent with the same `direction`) shows the price: it changes
   * only where Nodaro's setting for such runs first redraws the role pictures
   * in the art style.
   *
   * Style only: with no role with images and no fixed reference, the art style
   * alone is the run's change (a pre or post prompt is still added). It
   * restyles the whole clip, keeping the people, places, motion and sound, and
   * is charged for what it runs (the estimate shows it; no clip-preparation
   * `privacy` part). By default a black-and-white art style comes out
   * monochrome. Nodaro may run it the way other art-style runs run instead,
   * priced as those are and not made monochrome.
   * A preview takes its full run's path. Runs this way only on a Flex run, and
   * only where {@link VideoRemakeResource.styleChoice} answers `styleOnly` true
   * for the engine; elsewhere on Nodaro Prism an art style alone is
   * refused (on a Precise run that stays Precise too, unless
   * {@link VideoRemakeResource.styleChoice} answers `preciseArtStyleAlone` true for
   * the engine, where it is that run's change), and one with a pre or post prompt
   * runs as any other art-style run. The job records it in
   * `input_data.direction`.
   *
   * A custom style: `{ customStyle: "<text>" }` in place of `{ style }` gives
   * the style in your own words (see {@link VideoRemakeCustomStyleDirection}),
   * only where {@link VideoRemakeResource.styleChoice} answers `customStyle`
   * true for the engine. It goes wherever a catalog art style goes and counts
   * as the run's change wherever one does. Never both: send one of the two.
   */
  direction?: VideoRemakeArtStyleDirection | VideoRemakeCustomStyleDirection
  /**
   * What the clip is (see {@link VideoRemakeClipKind}). `"previz"` says it is
   * a 3D previz: the clip is then RENDERED into the run's look instead of
   * edited. Only where {@link VideoRemakeResource.styleChoice} answers
   * `previz` true, on Nodaro Prism, never as a draft; refusals:
   * {@link VideoRemakePrevizRefusalCode}. Left out, or `"footage"`: an
   * ordinary clip, the run as before. The job records it in
   * `input_data.clipKind`.
   */
  clipKind?: VideoRemakeClipKind
  /** A previz run's options (see {@link VideoRemakePrevizOptions}): only with `clipKind: "previz"`. */
  previz?: VideoRemakePrevizOptions
  /**
   * Nodaro Pulse only (Prism ignores it): which end of the clip is cut to
   * whole seconds (see {@link VideoRemakeMotionLength}). Default `"cut-end"`.
   */
  motionLength?: VideoRemakeMotionLength
  /** @deprecated use {@link motionLength} (still accepted). */
  klingLength?: VideoRemakeMotionLength
  /**
   * The size the video is delivered at (see {@link VideoRemakeResolution}).
   * Left out: the engine choice's default, its smallest size offered (720p).
   * The estimate answers the size the run delivers as its `resolution`.
   */
  resolution?: VideoRemakeResolution
  /**
   * `true` makes a draft: a 480p run whose same take Full Quality can finish
   * at 1080p (Nodaro Prism only; leave `resolution` out, or send `"480p"`).
   * Default `false`. `true` with a larger `resolution` answers 400 (draft is
   * 480p only). Nodaro Pulse has no draft: `true` answers 400
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
  faceMasking?: VideoRemakeFaceMasking
  /**
   * `"draft"` means 480p draft.
   * @deprecated use `resolution` + `draft`.
   */
  quality?: "draft"
  /** A generation session to file the result in. */
  sessionId?: string
  /** The client app that sent the run (stored on the job as `input_data.origin`). */
  origin?: string
  /**
   * What the person did about {@link VideoRemakeResource.intent}'s answer, on
   * a run that went ahead anyway (see {@link VideoRemakeRunIntent}). Read on
   * `run()` only; one that is not this shape is dropped, never refused.
   */
  intent?: VideoRemakeRunIntent
}

/**
 * The size a Video Remake run is delivered at (`resolution` on `run()` and
 * `estimate()`, on the estimate's answer and on a completed job's output;
 * `"4k"` is lower-case). Each engine choice offers its own, its default first:
 *
 * - Nodaro Prism and Nodaro Pulse: `"720p"` (default), `"1080p"` or `"4k"`;
 * - Nodaro Prism Flash and Nodaro Pulse Flash: `"720p"` (default) or `"1080p"`.
 *
 * A deployment may offer fewer: {@link VideoRemakeStyleChoice.resolutions}
 * lists what each engine choice offers there, and a size it does not offer is
 * refused 400 `resolution_not_offered`, the thrown `NodaroError`'s
 * `details.offered` naming the sizes it does (the body's `error.offered`). A
 * size offered that a given request cannot have is refused 409
 * `resolution_unavailable` before anything is held. Where `resolutions` is
 * empty, the deployment's engine does not deliver resolutions yet and
 * `resolution` is the size it makes: Nodaro Prism `"480p"` (default),
 * `"720p"` or `"1080p"`, Nodaro Pulse `"720p"` (default) or `"1080p"`, Nodaro
 * Prism Flash `"480p"` (default) or `"720p"`, Nodaro Pulse Flash `"720p"`.
 */
export type VideoRemakeResolution = "480p" | "720p" | "1080p" | "4k"

/**
 * The Video Remake keys of a completed job's output (`GET /v1/jobs/:id`,
 * `output_data`) that a client reads; the output carries others too.
 */
export interface VideoRemakeJobOutput {
  /** The delivered video. */
  videoUrl?: string
  /** The engine the run used, by its public id. */
  engine?: VideoRemakeEngineChoice
  /** The video's length in seconds: on a run of a part ({@link VideoRemakeParams.portionStart}), the part's length. */
  durationSec?: number
  /**
   * The size the video was delivered at (see {@link VideoRemakeResolution}).
   * Rarely smaller than the size asked for, when that size could not be
   * finished: this says the size the video has.
   */
  resolution?: VideoRemakeResolution
  [key: string]: unknown
}

/** What a run would cost, in credits. */
/**
 * What a run's clip is, as the caller states it (nothing detects it):
 * - `"footage"` (the default): an ordinary filmed or generated clip, edited as
 *   every run was before;
 * - `"previz"`: a 3D previz — simple untextured ("clay") models moved and
 *   filmed as the video to make will be. Its camera, rhythm, blocking and
 *   motion are followed and its look is not: it is rendered into the run's
 *   art style or custom style (`direction`), and with neither into real-world,
 *   live-action footage. Name each role by its model in the clip (its colour,
 *   or its shape and position: `name: "the pink model"`), say in `subject`
 *   what that model becomes (the finished thing, not the model), and give it
 *   the pictures that replace the model.
 */
export type VideoRemakeClipKind = "footage" | "previz"

/** A previz run's options ({@link VideoRemakeParams.previz}). */
export interface VideoRemakePrevizOptions {
  /**
   * `true`: the clip's lighting direction and its lighting changes are
   * followed too. Default `false`: the camera, the rhythm and the motion
   * alone.
   */
  lighting?: boolean
  /**
   * Whose sound the result has: `"clip"` keeps the clip's own sound,
   * `"generated"` has the engine make it (environmental and action sounds, no
   * music). Left out: the clip's sound when it has an audio track, generated
   * when it has none. Only an engine that takes the choice accepts the field;
   * an older one answers 400 `validation_error`.
   */
  sound?: "clip" | "generated"
}

/**
 * The `code` of a refusal that is about a 3D previz clip
 * (`NodaroError.code`), on {@link VideoRemakeResource.run},
 * {@link VideoRemakeResource.estimate} and
 * {@link VideoRemakeResource.fullQuality}. Nothing is charged.
 *
 * - `previz_not_available` (403): a 3D previz clip is not accepted here (see
 *   {@link VideoRemakeStyleChoice.previz}); send an ordinary clip;
 * - `previz_needs_prism` (400): it runs on Nodaro Prism only;
 * - `previz_not_for_trends` (400): never on a trend run;
 * - `previz_no_draft` (400): it has no draft; run it at 480p, 720p or 1080p;
 * - `previz_role_needs_locator` (400): a role with pictures has no `name`;
 *   name each role by its model in the clip (its colour, or its shape and
 *   position);
 * - `previz_needs_clip_kind` (400): `previz` was sent without
 *   `clipKind: "previz"`;
 * - `previz_no_full_quality` (409): a previz run has no Full Quality; run it
 *   again at the resolution you need.
 *
 * Open-ended: a code not listed here may still arrive.
 */
export type VideoRemakePrevizRefusalCode =
  | "previz_not_available"
  | "previz_needs_prism"
  | "previz_not_for_trends"
  | "previz_no_draft"
  | "previz_role_needs_locator"
  | "previz_needs_clip_kind"
  | "previz_no_full_quality"
  | (string & {})

/** A run's art style from the catalog: a `style` picker id (see {@link VideoRemakeParams}'s `direction`). */
export interface VideoRemakeArtStyleDirection {
  style: string
  customStyle?: never
}

/**
 * A run's custom style: the visual style in your own words, in place of a
 * catalog art style. Describe the look only: the medium (drawn, 3D-rendered
 * or filmed), line, colour, lighting and texture; not who or what is in the
 * video. At most 600 characters, never blank. The words are used as written;
 * the run itself works out whether the style is drawn, rendered or filmed, at
 * no extra charge (the estimate is the same as for a catalog art style). The
 * job records the text as sent in `input_data.direction.customStyle`.
 * {@link VideoRemakeResource.describeStyle} writes such a text from an image.
 *
 * Nodaro Prism only, on a direct run, and only where
 * {@link VideoRemakeResource.styleChoice} answers `customStyle` true for the
 * engine. Refusals: {@link VideoRemakeCustomStyleRefusalCode}.
 */
export interface VideoRemakeCustomStyleDirection {
  customStyle: string
  style?: never
}

/**
 * The `code` of a refusal that concerns a custom style (`NodaroError.code`),
 * all before anything is charged.
 *
 * On {@link VideoRemakeResource.run} and {@link VideoRemakeResource.estimate}:
 * - `custom_style_with_art_style` (400): `direction` carries both `style` and
 *   `customStyle`; send one;
 * - `custom_style_empty` (400): the text is blank, or nothing is left of it
 *   once its curly braces are taken out;
 * - `custom_style_too_long` (400): more than 600 characters;
 * - `custom_style_not_available` (403): a custom style is not offered here
 *   (see {@link VideoRemakeStyleChoice.customStyle}); choose a catalog art
 *   style instead;
 * - `raw_reference_token` (400): the text holds `{image:…}`, `{video:…}` or
 *   `{audio:…}`;
 * - `art_style_needs_prism` / `art_style_needs_flex` (400): where a catalog
 *   art style could not go either (Nodaro Pulse, a trend run).
 *
 * On {@link VideoRemakeResource.describeStyle}:
 * - `unauthorized` (401): no authenticated user;
 * - `validation_error` (400), `unsafe_url` (400): the body, or an address that
 *   is not a public http(s) one;
 * - `custom_style_not_available` (403): as above;
 * - `image_unreadable` (400): the image could not be fetched, is larger than
 *   10 MB, or is not a PNG, JPEG, WebP or GIF;
 * - `describe_style_failed` (502): the image could not be described just now;
 *   try again;
 * - `style_not_described` (422): no style could be described from this image;
 *   try another, or write the style yourself;
 * - `rate_limit_exceeded` (429): too many calls in a minute for this account.
 *
 * Open-ended: a code not listed here may still arrive.
 */
export type VideoRemakeCustomStyleRefusalCode =
  | "custom_style_with_art_style"
  | "custom_style_empty"
  | "custom_style_too_long"
  | "custom_style_not_available"
  | "raw_reference_token"
  | "art_style_needs_prism"
  | "art_style_needs_flex"
  | "unauthorized"
  | "validation_error"
  | "unsafe_url"
  | "image_unreadable"
  | "describe_style_failed"
  | "style_not_described"
  | "rate_limit_exceeded"
  | (string & {})

/** What {@link VideoRemakeResource.describeStyle} takes. */
export interface VideoRemakeDescribeStyleParams {
  /** A public http(s) image (PNG, JPEG, WebP or GIF, at most 10 MB) whose visual style is put into words. */
  imageUrl: string
  /** A wish about the style, at most 600 characters ("like this, but darker"). */
  note?: string
}

/** The medium a described style reads as: drawn or painted, computer-rendered or modelled, or filmed. */
export type VideoRemakeStyleMedium = "2d" | "3d" | "photo"

/** The tones a described style reads as. */
export type VideoRemakeStyleTones = "colour" | "black-and-white" | "one-colour"

/** What {@link VideoRemakeResource.describeStyle} answers. */
export interface VideoRemakeDescribedStyle {
  /** The image's visual style in words (never its content), at most 600 characters: ready to edit and send as `direction.customStyle`. */
  text: string
  /** How the description reads, a hint for an interface only: a run works out its style's medium itself, from the words it is sent. */
  medium?: VideoRemakeStyleMedium
  /** As `medium`. */
  tones?: VideoRemakeStyleTones
}

/** What {@link VideoRemakeResource.planRoles} takes. */
export interface VideoRemakePlanRolesParams {
  /**
   * The clip, a public http(s) URL, 4–30 s (2–30 s where
   * {@link VideoRemakeStyleChoice.shortClips} is `true`; up to 10 minutes
   * with a part or a preview where {@link VideoRemakeStyleChoice.portion} is
   * `true`).
   */
  videoUrl: string
  /**
   * The request in the person's own words, at most 4000 characters, in any
   * language: who or what each image replaces, and whatever else they want
   * changed. For example `"put the first photo in place of the woman on the
   * left, use the second as the room, and make it rain"`. It may say nothing
   * of an image, be empty or be left out: the images alone are enough, and an
   * image the request does not place is placed by what it shows and what the
   * clip shows (see {@link VideoRemakePlanRolesDecision}).
   */
  prompt?: string
  /** 1–30 public http(s) images (PNG, JPEG, WebP or GIF, at most 10 MB each): the loose reference pictures, in the order the person gave them. */
  images: string[]
  /** The engine the run will use (default Nodaro Prism). Nodaro Pulse sends fewer images, so more may come back unresolved. */
  engine?: VideoRemakeEngine | VideoRemakeEngineLegacyId
  /** The roles the caller already has, as a run takes them: never changed or repeated, and counted against the limits. */
  roles?: VideoRemakeRole[]
  /** The fixed references the caller already has, as a run takes them: counted against the limits. */
  references?: VideoRemakeReference[]
  /** `true` when the run will be a 4 s preview: the plan is then made from those 4 s alone. */
  preview?: boolean
  /** Where the preview starts, in seconds (default 0); `previewStart + 4` must fit the clip. */
  previewStart?: number
  /**
   * The part of the clip the run will be made of (see
   * {@link VideoRemakeParams.portionStart}): the plan is then made from that
   * part alone. Send the same part to the estimate and the run. Only where
   * {@link VideoRemakeResource.styleChoice} answers `portion` true.
   */
  portionStart?: number
  /** The part's length in seconds, with {@link portionStart}. */
  portionSec?: number
  /**
   * What the clip is, as the run will state it (see
   * {@link VideoRemakeClipKind}). `"previz"` says it is a 3D previz: the plan
   * is then made for stand-in models, and each planned role comes back as a
   * previz run's role, its `name` the locator of its model in the clip and
   * its `subject` who or what the model becomes (taken from the request where
   * it says so, else from what the role's images show; left out when none
   * could be had). Send the same `clipKind` to {@link VideoRemakeResource.estimate}
   * and {@link VideoRemakeResource.run} with the planned roles. Only where
   * {@link VideoRemakeResource.styleChoice} answers `planRolesPreviz` true:
   * elsewhere leave it out (a server that does not plan such a clip refuses
   * the field, 400 `validation_error`). Refused as a run refuses such a clip
   * (see {@link VideoRemakePlanRolesRefusalCode}). Left out or `"footage"`:
   * an ordinary clip, the plan as before.
   */
  clipKind?: VideoRemakeClipKind
  /**
   * The previz options the run will carry (see
   * {@link VideoRemakePrevizOptions}): only with `clipKind: "previz"`. They
   * are checked as a run's and change nothing of the plan.
   */
  previz?: VideoRemakePrevizOptions
}

/**
 * Why an image became no role and no reference
 * ({@link VideoRemakePlannedRoles.unresolved}):
 * - `ambiguous_subject`: the request could mean several subjects in the video
 *   (`candidates` lists them);
 * - `subject_not_in_clip`: nobody and nothing in the clip matches the request;
 * - `kind_unclear`: the image could be a person, a pet, a product or a
 *   location, and the request does not settle which;
 * - `same_subject_unclear`: several images may or may not be of one subject;
 * - `over_limit`: a run takes fewer roles of that kind, images for one
 *   subject, references or images in all than were asked for;
 * - `not_placed`: the image was left out of the plan, or the request asked
 *   for something its words do not show.
 *
 * Open-ended: a reason not listed here may still arrive.
 */
export type VideoRemakePlanRolesUnresolvedReason =
  | "ambiguous_subject"
  | "subject_not_in_clip"
  | "kind_unclear"
  | "same_subject_unclear"
  | "over_limit"
  | "not_placed"
  | (string & {})

/**
 * How one planned role was decided ({@link VideoRemakePlannedRoles.decisions}):
 * - `role`: the role's position in `roles`, from 0 (`decisions[i].role` is
 *   `i`);
 * - `basis`: `"request"` when the request's own words asked for it
 *   (`evidence`: those words), `"inferred"` when the request said nothing
 *   about its images and they were placed by what they show and what the clip
 *   shows;
 * - `confidence`, for an inferred role: `"clear"` when exactly one subject of
 *   its kind fitted, `"guess"` when it is the best fit among several: show a
 *   guess to the person before running;
 * - `alternatives`: with a guess, the other subjects it could have been, each
 *   named as a role's `name` names one.
 *
 * Open-ended: a value not listed here may still arrive.
 */
export interface VideoRemakePlanRolesDecision {
  role: number
  basis: "request" | "inferred" | (string & {})
  evidence?: string
  confidence?: "clear" | "guess" | (string & {})
  alternatives?: string[]
}

/** Images {@link VideoRemakeResource.planRoles} could not place: ask the person, then set a role for them or plan again with a clearer request. */
export interface VideoRemakePlanRolesUnresolved {
  /** The images, as they were sent. */
  images: string[]
  /** Their positions in the `images` sent, from 0. */
  imageIndexes: number[]
  reason: VideoRemakePlanRolesUnresolvedReason
  /** With `ambiguous_subject`: the subjects of the video it could be, each a short description. */
  candidates?: string[]
}

/**
 * What {@link VideoRemakeResource.planRoles} answers. Every image sent is in
 * exactly one of `roles`, `references` and `unresolved`.
 */
export interface VideoRemakePlannedRoles {
  /** The request, untouched. */
  prompt: string
  /**
   * The NEW roles, each exactly as a run's `roles` takes one (`name` says
   * which subject of the video it replaces; its `images` are addresses that
   * were sent). Add them after the roles you already have. Planned for a 3D
   * previz clip (`clipKind: "previz"`): `name` is the locator of the role's
   * model in the clip and `subject`, where one could be had, who or what the
   * model becomes.
   */
  roles: VideoRemakeRole[]
  /**
   * How each of `roles` was decided, one entry per role in the same order
   * (`decisions[i]` is about `roles[i]`), kept out of the role so that
   * `roles` goes to a run as it is. Optional in the type only for a server
   * from before it: treat every role as said by the request there.
   */
  decisions?: VideoRemakePlanRolesDecision[]
  /** The NEW fixed references, each as a run's `references` takes one. */
  references: VideoRemakeReference[]
  /**
   * What is left of the request once the parts the roles and references now
   * say are taken out: send it as the run's `postPrompt`. Only ever the
   * request's own characters, in order and in its own language; `""` when
   * nothing is left, and the whole request when nothing was planned.
   */
  postPrompt: string
  /** The parts of the request that were taken out, as the request had them. */
  removed: string[]
  /** The images that became no role and no reference, with why. Empty when every image was placed. */
  unresolved: VideoRemakePlanRolesUnresolved[]
}

/**
 * The `code` of a refusal of {@link VideoRemakeResource.planRoles}
 * (`NodaroError.code`). Nothing is ever charged.
 *
 * - `unauthorized` (401): no authenticated user;
 * - `validation_error` (400), `unsafe_url` (400): the body, or an address that
 *   is not a public http(s) one;
 * - `plan_roles_not_available` (403): roles are not planned from the prompt
 *   here (see {@link VideoRemakeStyleChoice.planRoles}); set the roles
 *   yourself;
 * - `model_not_available` / `node_not_available` (403): Video Remake is not
 *   offered to this account;
 * - `video_unreadable` (400): the clip's length could not be read;
 * - `clip_out_of_range` (400): the clip is not 4–30 s long (2–30 s where
 *   {@link VideoRemakeStyleChoice.shortClips} is `true`);
 * - `preview_out_of_range` (400): `previewStart + 4` does not fit the clip;
 * - with a part of the clip, a run's own refusals of one (see
 *   {@link VideoRemakeParams.portionStart}): `portion_unavailable`,
 *   `portion_incomplete`, `portion_with_preview`, `portion_out_of_range`,
 *   `source_too_long` and `long_source_unpriceable` (each 400);
 * - `image_unreadable` (400): an image could not be fetched, is larger than
 *   10 MB, or is not a PNG, JPEG, WebP or GIF (the envelope's `details.index`, read as
 *   `NodaroError.details.details.index`: its position in `images`, from 0);
 * - `plan_roles_failed` (502): the roles could not be planned just now; try
 *   again, or set the roles yourself;
 * - with `clipKind: "previz"`, a run's own refusals of such a clip (see
 *   {@link VideoRemakePrevizRefusalCode}): `previz_not_available` (403),
 *   `previz_needs_prism` (400), `previz_needs_clip_kind` (400: `previz`
 *   without `clipKind: "previz"`), `previz_role_needs_locator` (400: a role
 *   you already have has pictures and no `name`) and `previz_not_for_trends`
 *   (400);
 * - `rate_limit_exceeded` (429): too many calls for this account, in a minute
 *   or in a day (`Retry-After` says how long).
 *
 * A route missing altogether (404, an older server) means the same as
 * `plan_roles_not_available`. Open-ended: a code not listed here may still
 * arrive.
 */
export type VideoRemakePlanRolesRefusalCode =
  | "unauthorized"
  | "validation_error"
  | "unsafe_url"
  | "plan_roles_not_available"
  | "model_not_available"
  | "node_not_available"
  | "video_unreadable"
  | "clip_out_of_range"
  | "preview_out_of_range"
  | "portion_unavailable"
  | "portion_incomplete"
  | "portion_with_preview"
  | "portion_out_of_range"
  | "source_too_long"
  | "long_source_unpriceable"
  | "image_unreadable"
  | "plan_roles_failed"
  | "previz_not_available"
  | "previz_needs_prism"
  | "previz_needs_clip_kind"
  | "previz_role_needs_locator"
  | "previz_not_for_trends"
  | "rate_limit_exceeded"
  | (string & {})

export interface VideoRemakeEstimate {
  /**
   * The engine the run would use, by its public id (absent from an older
   * server = `"nodaro-prism"`), or the Flash choice it was asked for. An id an
   * older server answers is read as the public id it names.
   */
  engine?: VideoRemakeEngineChoice
  /**
   * What is held when the run starts. The run is charged what it actually
   * costs, which is expected to be `expectedCredits`.
   */
  totalCredits: number
  /**
   * The charge the run is expected to come to. Never above `totalCredits`
   * (on Nodaro Pulse it equals it: Pulse renders exactly the length
   * asked for, so the hold is what it settles at). Absent from an older
   * server: read `totalCredits` then.
   */
  expectedCredits?: number
  /**
   * The parts of the quote, by name, for display only:
   * - `base`: the run itself (its base fee). An older server
   *   names it `castSwap` instead: read `base`, else `castSwap`;
   * - `references`: preparing the reference pictures (0 when
   *   `prepareReferences` is off or there is nothing to prepare);
   * - `motion`: what the video holds (on Nodaro Pulse, what it costs);
   * - `motionExpected`: what the video is expected to be charged, never above
   *   `motion` (Nodaro Prism);
   * - `privacy`: preparing the clip, when the engine's setting does. In both
   *   totals when it always runs; outside both when it is the retry
   *   (`privacyCredits`).
   * - `prompt`: the prompt written for the run by a language model, when
   *   Nodaro's setting for the engine does so (absent otherwise).
   * - `referenceAudio`: preparing the clip's sound for the video model, when
   *   Nodaro's setting for the engine runs that step (absent otherwise).
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
    prompt?: number
    referenceAudio?: number
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
   * `true` when the video is made at Auto length (every Nodaro Prism
   * run): the final charge is expected to come out lower than `totalCredits`,
   * at about `expectedCredits`. `false` on Nodaro Pulse.
   */
  settlesLower: boolean
  /**
   * Present only while the signed-in account may still take its first
   * Remake on us (it never bought anything and has not used it; see
   * `UserBalance.firstRemakeOffer`). `allowed`: these options are a run the
   * offer covers; `coverCredits`: what the offer would cover of this quote
   * (0 when the balance covers it, or the options are not covered).
   */
  firstRemakeOffer?: FirstRemakeOfferQuote
  /**
   * The size the run would deliver (see {@link VideoRemakeResolution}).
   * Absent from a server whose engine does not answer it.
   */
  resolution?: VideoRemakeResolution
}

/** `VideoRemakeEstimate.firstRemakeOffer` / `TrendEstimate.firstRemakeOffer`. */
export interface FirstRemakeOfferQuote {
  /** Whether this request's options are a run the offer covers. */
  allowed: boolean
  /** The credits the offer would cover of this quote; 0 when the balance covers it, or `allowed` is false. */
  coverCredits: number
}

/** Per-call options for {@link VideoRemakeResource.run}. */
export interface VideoRemakeRunOptions {
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
 * What a Full Quality version would be: `"same-take"` finishes a Nodaro
 * Prism draft's own take at 1080p, and the draft stays. `"new-take"` was a new
 * Nodaro Pulse take at 1080p from a 720p run's inputs; Pulse no longer
 * has Full Quality, so a quote no longer answers it (kept so code that reads
 * it still compiles).
 */
export type VideoRemakeFullQualityKind = "same-take" | "new-take"

/**
 * What a Full Quality version of a run would cost
 * (`POST /v1/video-remake/:jobId/full-quality/estimate`): a Nodaro Prism
 * draft (a 480p run made with `draft: true`).
 */
export interface VideoRemakeFullQualityEstimate {
  /**
   * Which Full Quality this is ({@link VideoRemakeFullQualityKind}), so it can
   * be worded right. Absent from an older server: `"same-take"`.
   */
  kind?: VideoRemakeFullQualityKind
  /** The quote in credits: `breakdown.base` plus the 1080p render (same take) or the new take. */
  totalCredits: number
  /**
   * The parts of the quote, by name, for display only: `base` (the Full
   * Quality job's own steps; an older server names it
   * `castSwap` instead: read `base`, else `castSwap`), and `motionHd` (a same
   * take: the 1080p render; an older server answers 0 when an earlier try of
   * this draft already finished that render, see {@link renderReused}) or
   * `motion` (a new take).
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
  /** Whether an earlier try's 1080p render is reused, so only the finishing is charged. Absent from an older server: read `breakdown.motionHd === 0`. */
  renderReused?: boolean
}

/** Options for {@link VideoRemakeResource.fullQuality}. */
export interface VideoRemakeFullQualityParams {
  /** A generation session to file the Full Quality result in. */
  sessionId?: string
}

/** The Full Quality job (`POST /v1/video-remake/:jobId/full-quality`). */
export interface VideoRemakeFullQualityResult {
  jobId: string
  /** `true` when this run's Full Quality was already running or done: that job is answered, nothing new is started or charged. */
  existing?: boolean
}

/**
 * The `code` of a Full Quality refusal (`NodaroError.code`), all before
 * anything is charged:
 * - `unauthorized` (401): no authenticated user;
 * - `not_found` (404): not your job, or not a Video Remake run; also a
 *   `sessionId` you may not use;
 * - `not_completed` (409): the run has not finished;
 * - `not_a_draft` (409): the run is not a Nodaro Prism draft: a plain
 *   run (480p made without `draft: true` included; make a draft with
 *   `draft: true`), or any Nodaro Pulse run (Pulse makes no drafts: run
 *   it again at 1080p);
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
export type VideoRemakeFullQualityRefusalCode =
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

/**
 * Who decides a direct run's style on one engine:
 * - `"user"`: the person (the request's `style`, left out = `"precise"`);
 *   show a Style control;
 * - `"precise"`: Nodaro's own apps run Precise on that engine and show no
 *   Style control; it changes no request: a direct run and quote take the
 *   request's `style`, as on `"user"`;
 * - `"flex"`: an admin forced it — every direct run and quote of that engine
 *   runs Flex (`style: "motion"`) whatever the request's `style` says; show
 *   no Style control.
 *
 * A trend run keeps its own trend's style.
 */
export type VideoRemakeStyleChoiceOption = "user" | "precise" | "flex"

/** What {@link VideoRemakeResource.styleChoice} answers: every engine's choice, by its public id. */
export interface VideoRemakeStyleChoice {
  engines: Record<VideoRemakeEngine, VideoRemakeStyleChoiceOption>
  /**
   * Per engine, whether the engine takes style-only runs: a Flex run
   * (`style: "motion"`) with an art style (`direction`) and nothing to swap
   * (no role with images, no fixed reference). It follows the engine alone, so
   * read it with {@link engines}: an engine answered `"flex"` makes a Precise
   * request Flex too, and one answered `"precise"` changes no request, so a
   * Flex request there runs as on `"user"`. Nodaro Pulse is always
   * `false` (it takes no art style). Absent from an older server, and
   * an engine missing from it: `false`.
   */
  styleOnly?: Partial<Record<VideoRemakeEngine, boolean>>
  /**
   * Per engine, whether a Precise run (no `style`, or `"precise"`) takes an
   * art style (`direction`), as a Flex run does. Nodaro may run such a request as
   * a Flex run (see {@link VideoRemakeParams}'s `direction`), which this does not
   * say; otherwise it is Precise's edit of the clip, drawn in the art style, and,
   * where {@link VideoRemakeStyleChoice.preciseArtStyleAlone} is not true for the
   * engine, not on its own: a Precise run with nothing else to change is then refused.
   * Nodaro Pulse is always `false` (it takes no art style). Absent from
   * an older server, and an engine missing from it: `false` (offer an art style
   * on Flex runs alone).
   */
  preciseArtStyle?: Partial<Record<VideoRemakeEngine, boolean>>
  /**
   * Per engine, whether an art style (`direction`) alone is a Precise run's
   * change there, so the run needs no role, reference or prompt. Nodaro may run
   * such a request as a Flex run (see {@link VideoRemakeParams}'s `direction`), which
   * this does not say. It answers
   * `false` until the engine takes such runs. Nodaro Pulse is always
   * `false` (it takes no art style). Absent from an older server, and an engine
   * missing from it: `false`.
   */
  preciseArtStyleAlone?: Partial<Record<VideoRemakeEngine, boolean>>
  /**
   * Per engine, whether a direct run takes a custom style there: the style in
   * your own words (`direction: { customStyle }`, see
   * {@link VideoRemakeCustomStyleDirection}) in place of a catalog art style,
   * and {@link VideoRemakeResource.describeStyle} with it. `true` only where
   * the engine takes one and Nodaro offers it on this deployment. Nodaro
   * Pulse is always `false` (it takes no art style). Absent from an older
   * server, and an engine missing from it: `false` (offer the catalog's art
   * styles alone; a custom style sent anyway is refused).
   */
  customStyle?: Partial<Record<VideoRemakeEngine, boolean>>
  /**
   * Whether roles can be planned from the prompt here
   * ({@link VideoRemakeResource.planRoles}): one answer for the deployment,
   * not per engine. `true` only where the engine plans roles and Nodaro
   * offers it on this deployment. Absent from an older server: `false` (offer
   * the roles to be set by hand; a planning call sent anyway is refused).
   */
  planRoles?: boolean
  /**
   * Whether the roles of a 3D previz clip can be planned here
   * ({@link VideoRemakeResource.planRoles} with `clipKind: "previz"`): one
   * answer for the deployment, not per engine. `true` only where the engine
   * plans such a clip's roles and both `planRoles` and `previz` are `true`.
   * Absent from an older server: `false` (send no `clipKind` to
   * `planRoles()`; one sent anyway is refused 400 `validation_error`).
   */
  planRolesPreviz?: boolean
  /**
   * Whether a run may state that its clip is a 3D previz here
   * (`clipKind: "previz"`, see {@link VideoRemakeClipKind}): one answer for
   * the deployment, not per engine. `true` only where the engine takes such a
   * clip and Nodaro accepts it on this deployment. Absent from an older
   * server: `false` (offer ordinary clips alone; a previz run sent anyway is
   * refused 403 `previz_not_available`).
   */
  previz?: boolean
  /**
   * Whether a person role may keep its own face from the video here (the Face
   * chip, `face: "original"` on a {@link VideoRemakePersonRole}): one answer
   * for the deployment, not per engine. `true` only where the engine keeps
   * faces. Absent from an older server: `false` (offer no Face choice; a run
   * sent `face: "original"` anyway is refused 409 `engine_unsupported`).
   */
  roleFace?: boolean
  /**
   * Per engine, whether its Flash choice is offered here: Nodaro Prism Flash
   * (`engine: "nodaro-prism-flash"`) beside Nodaro Prism, Nodaro Pulse Flash
   * (`"nodaro-pulse-flash"`) beside Nodaro Pulse (see
   * {@link VideoRemakeFlashEngine}). `true` only where the engine runs it and
   * Nodaro offers it on this deployment; a run naming one anywhere else is
   * refused 409 `flash_not_offered`. Every other map here is read for a Flash
   * choice under its engine. Absent from an older server, and an engine
   * missing from it: `false` (offer the two engines alone).
   */
  flash?: Partial<Record<VideoRemakeEngine, boolean>>
  /**
   * Per engine choice (each engine and Flash choice), the sizes a run is
   * delivered at here, smallest (the default) first (see
   * {@link VideoRemakeResolution}): e.g. `{ "nodaro-prism": ["720p", "1080p",
   * "4k"], "nodaro-pulse": ["720p", "1080p", "4k"], "nodaro-prism-flash":
   * ["720p", "1080p"], "nodaro-pulse-flash": ["720p", "1080p"] }`. List
   * exactly these. Whether a Flash choice is offered at all is {@link flash}'s
   * to say. `{}` where the deployment's engine does not deliver resolutions
   * yet (`resolution` is then the engine's size). Absent from an older
   * server: treat it as `{}`.
   */
  resolutions?: Partial<Record<VideoRemakeEngineChoice, VideoRemakeResolution[]>>
  /**
   * Whether a run, its estimate and {@link VideoRemakeResource.planRoles}
   * take a part of the clip here ({@link VideoRemakeParams.portionStart} and
   * {@link VideoRemakeParams.portionSec}): one answer for the deployment, not
   * per engine, `true` only where the deployment's engine has it switched on.
   * Elsewhere a run or estimate that sends either field is refused 400
   * `portion_unavailable`. Absent from an older server: `false` (offer no
   * part of the clip).
   */
  portion?: boolean
  /**
   * Whether a clip of 2 seconds or more is accepted here (a clip shorter
   * than the engine's shortest output is lengthened, run and cut back, and
   * priced at the lengthened length), instead of 4 seconds or more. One
   * answer for the deployment, `true` only where the deployment's engine has
   * it switched on and says so. Absent, or `false`: the clip must be 4–30 s;
   * the estimate stays the authority (a clip outside the range answers
   * `clip_out_of_range`).
   */
  shortClips?: boolean
}

/**
 * What {@link VideoRemakeResource.advanced} answers: whether the Video Remake
 * page shows its Advanced options.
 */
export interface VideoRemakeAdvanced {
  /**
   * Whether the Video Remake page shows `prepareReferences` and `prePrompt`
   * under its Advanced options: `false` until Nodaro turns them on, one
   * setting for the whole page, the same for every engine.
   */
  show: boolean
}

/**
 * One art style of {@link VideoRemakeResource.artStyles}: a style Video
 * Remake's art style picker offers, with its preview.
 */
export interface VideoRemakeArtStyle {
  /** The style's id: what a run takes as `direction.style` (an id of the `style` picker catalog). */
  id: string
  /** The style's name in the language asked for; English where that language does not name it. */
  label: string
  /** A short clip of real footage wiping into the style (an absolute https address). */
  clipUrl: string
  /** A still frame cut from that clip (an absolute https address). */
  stillUrl: string
}

/**
 * A finished run's side by side ({@link VideoRemakeResource.sideBySide}):
 * `ready` with the file's address, or `making` / `waiting` while it is
 * rendered (ask again in a few seconds). `waiting`: another of the account's
 * runs is being rendered first.
 */
export type VideoRemakeSideBySide =
  | {
      status: "ready"
      /** The MP4: the original clip and the remake together, the remake's sound. */
      url: string
      /** A file name to save it under. */
      fileName: string
      width: number
      height: number
      /** `"stack"`: the original above the remake (a wide run); `"side"`: the original on the left (a square or tall one). */
      layout: "stack" | "side"
    }
  | { status: "making" | "waiting" }

/**
 * One preview of {@link VideoRemakeResource.previews}: a before-and-after of
 * what Video Remake does, as Nodaro's pages show it. Every address is an
 * absolute https address; every clip is silent and 16:9.
 */
export interface VideoRemakePreview {
  /** The preview's id, stable across languages. */
  id: string
  /** What it shows Video Remake doing. */
  kind: "restyle" | "motion" | "object" | "background" | "edit"
  /** Its title in the language asked for; English where that language has none. */
  title: string
  /** Its caption in the language asked for; English where that language has none. */
  caption: string
  /** The source clip. */
  sourceUrl: string
  /** The result clip. */
  resultUrl: string
  /** The source wiping into the result. */
  sweepUrl: string
  /** The source above the result, the same frames. */
  stackedUrl: string
  /** A still frame of `sweepUrl`, for showing before (or instead of) the clip. */
  posterUrl: string
  /** The same frame of `stackedUrl`. */
  stackedPosterUrl: string
  /** The page of the Nodaro tools site the preview leads to (a path, e.g. `/video/remake`). */
  href: string
}

/**
 * What a request's words may ask for that Video Remake does not do, as
 * {@link VideoRemakeResource.intent} names it, each with a good place to send
 * the person instead:
 * - `"wants-extend"`: continue the clip past its end;
 * - `"wants-voice-change"`: change the voices of the people in it;
 * - `"wants-dub"`: the speech in another language;
 * - `"wants-recast"`: a different story, or people moving differently than they do in the clip;
 * - `"wants-new-video"`: a new video that is not an edit of this clip;
 * - `"wants-join"`: join or reorder several clips;
 * - `"wants-reframe"`: another shape or aspect ratio;
 * - `"wants-shorter"`: trim or cut the clip.
 */
export type VideoRemakeIntentPopupCode =
  | "wants-extend"
  | "wants-voice-change"
  | "wants-dub"
  | "wants-recast"
  | "wants-new-video"
  | "wants-join"
  | "wants-reframe"
  | "wants-shorter"

/**
 * Further things a request may ask for that Video Remake does not do. Nodaro's
 * own apps show nothing for these and let the run go ahead:
 * - `"wants-lipsync"`: someone saying or singing other words;
 * - `"wants-upscale"`: only a sharper or larger video, nothing else changed;
 * - `"wants-captions"`: subtitles or captions;
 * - `"wants-sound"`: other music, sound effects or sound;
 * - `"wants-speed"`: faster, slower, reversed or looped;
 * - `"wants-watermark-removal"`: a watermark or logo taken off.
 */
export type VideoRemakeIntentReportedCode =
  | "wants-lipsync"
  | "wants-upscale"
  | "wants-captions"
  | "wants-sound"
  | "wants-speed"
  | "wants-watermark-removal"

/** Every code {@link VideoRemakeResource.intent} names today. */
export type VideoRemakeIntentCode = VideoRemakeIntentPopupCode | VideoRemakeIntentReportedCode

/**
 * The answer of {@link VideoRemakeResource.intent}:
 * - `{ checked: false, fits: true }`: not checked (the check is off on this
 *   deployment, took too long, or there were no words to read). Go ahead.
 * - `{ checked: true, fits: true }`: the words fit what Video Remake does.
 * - `{ checked: true, fits: false, code }`: the words ask for something else;
 *   `code` says what (see {@link VideoRemakeIntentCode}). A code this SDK does
 *   not know may come from a newer server: treat it as a fit.
 */
export interface VideoRemakeIntentCheck {
  checked: boolean
  fits: boolean
  code?: VideoRemakeIntentCode | (string & {})
}

/**
 * What the person did about the check's answer: `"continued"` = they were
 * shown what the words ask for and went on anyway; `"unserved"` = the check
 * named a code the app shows nothing for, and the run went ahead.
 */
export type VideoRemakeIntentAction = "continued" | "unserved"

/**
 * A run's `intent`: the check's `code` (kebab-case, at most 40 characters)
 * and what the person did about it. Send it only on a run that went ahead
 * after a `fits: false` answer.
 */
export interface VideoRemakeRunIntent {
  code: VideoRemakeIntentCode | (string & {})
  action: VideoRemakeIntentAction
}

/**
 * How long {@link VideoRemakeResource.intent} waits by default: the check is quick (a few seconds at most), and a
 * slower answer is no answer, so a run is never held up by it.
 */
const INTENT_TIMEOUT_MS = 10_000

/**
 * How long {@link VideoRemakeResource.planRoles} waits by default: longer than the server gives the plan and its checks
 * (about three minutes), so a slow plan is answered rather than cut off here.
 */
const PLAN_ROLES_TIMEOUT_MS = 200_000

export class VideoRemakeResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * Start a Video Remake run (`POST /v1/video-remake`, 202 `{ jobId }`). Returns the
   * job to follow. With `options.idempotencyKey` (sent as the
   * `Idempotency-Key` header; 8–200 characters, else 400) a repeat with the
   * same key within about 10 s answers 200 `{ jobId, deduped: true }`, a later
   * one 202 with the first run's `jobId`; nothing new starts.
   */
  run(params: VideoRemakeParams, options?: VideoRemakeRunOptions): Promise<{ jobId: string; deduped?: boolean }> {
    return this.client.request("POST", "/v1/video-remake", {
      body: params,
      ...(options?.idempotencyKey ? { headers: { "Idempotency-Key": options.idempotencyKey } } : {}),
    })
  }

  /**
   * Whether people choose a direct run's style, per engine
   * (`GET /v1/video-remake/style-choice`): `"user"` = show a Style control;
   * `"precise"` = Nodaro's own apps run Precise on that engine and hide the
   * control, while a run's `style` is still taken as sent; `"flex"` = an admin
   * forced Flex for the engine, so a run's `style` is overridden and the
   * control is best hidden. Its
   * `styleOnly` says, per engine, whether a Flex run with an art style and
   * nothing to swap restyles the whole clip there. Where it is not `true`
   * (absent, or an engine missing from it, included) on Nodaro Prism, an
   * art style alone is refused, and one with a pre or post prompt runs as any
   * other art-style run. Its `preciseArtStyle` says, per engine, whether a
   * Precise run takes an art style there too, and its `preciseArtStyleAlone`
   * whether that art style alone is the run's change. Its `customStyle` says,
   * per engine, whether a run takes the style in your own words there
   * (`direction: { customStyle }`, and {@link describeStyle}), and its
   * `planRoles` whether roles can be planned from the prompt here
   * ({@link planRoles}), its `planRolesPreviz` whether a 3D previz clip's
   * roles can be planned too, and its `previz` whether a run may state a 3D previz
   * clip here (`clipKind: "previz"`), and its `roleFace` whether a person role
   * may keep its own face here (`face: "original"`), its `resolutions` the
   * sizes each engine choice delivers, its `portion` whether a run takes a part
   * of the clip (`portionStart`, `portionSec`) and its `shortClips` whether a
   * clip of 2 s or more is accepted.
   * Public (no sign-in needed); the answer may be up to a minute old.
   */
  styleChoice(): Promise<VideoRemakeStyleChoice> {
    return this.client.request("GET", "/v1/video-remake/style-choice")
  }

  /**
   * Whether the Video Remake page shows its Advanced options
   * (`GET /v1/video-remake/advanced`): `show` is `true` where the page offers
   * `prepareReferences` and `prePrompt`, and `false` until Nodaro turns them
   * on. One answer for the whole page, whatever the engine, so an app built
   * on the SDK can show or hide the same options. It describes the page only:
   * {@link run} and {@link estimate} take both fields as sent, whatever it
   * answers.
   * Public (no sign-in needed); the answer may be up to a minute old.
   */
  advanced(): Promise<VideoRemakeAdvanced> {
    return this.client.request("GET", "/v1/video-remake/advanced")
  }

  /**
   * Put an image's visual style into words
   * (`POST /v1/video-remake/describe-style`): `text` describes how the image
   * is made and how it looks (the medium, line, colour, lighting and
   * texture), never who or what it shows, ready to show, edit and send as a
   * run's `direction: { customStyle: text }`. With `note`, a wish about the
   * style is folded in ("like this, but darker"). Free: it starts no job and
   * charges nothing, and nothing of the image is kept. Needs a signed-in
   * account, and is limited to 10 calls a minute per account. Only where
   * {@link styleChoice} answers `customStyle` true (403
   * `custom_style_not_available` elsewhere). Refusals:
   * {@link VideoRemakeCustomStyleRefusalCode}.
   */
  describeStyle(params: VideoRemakeDescribeStyleParams): Promise<VideoRemakeDescribedStyle> {
    const body = { imageUrl: params.imageUrl, ...(params.note !== undefined ? { note: params.note } : {}) }
    return this.client.request("POST", "/v1/video-remake/describe-style", { body })
  }

  /**
   * Plan a run's roles from a request in the person's own words
   * (`POST /v1/video-remake/plan-roles`): given the clip, the request and the
   * loose reference images, it answers which subject of the video each image
   * replaces, as ordinary `roles` and fixed `references`, with the rest of the
   * request as `postPrompt`. Nothing runs: send the answer to
   * {@link estimate} and {@link run} as any roles (after the roles you
   * already have), and show it to the person first — `unresolved` lists the
   * images it could not place, with why. An image the request does not mention
   * is placed from the image and the video, and a role picked as the best fit
   * among several is marked a guess (`decisions`): tell the person which.
   *
   * Free: it starts no job and charges nothing, and nothing of the clip or
   * the images is kept. Needs a signed-in account, and is limited to 6 calls a
   * minute and 60 a day per account. Only where {@link styleChoice} answers
   * `planRoles` true (403 `plan_roles_not_available` elsewhere). For a 3D
   * previz clip send `clipKind: "previz"` (where {@link styleChoice} answers
   * `planRolesPreviz` true): each role then comes back with its model's
   * locator as `name` and what it becomes as `subject`. Refusals:
   * {@link VideoRemakePlanRolesRefusalCode}.
   *
   * The plan and its checks can take up to about three minutes, so this call
   * waits 200 s whatever the client's
   * `timeoutMs`; pass `options.timeoutMs` to wait another time, and
   * `options.signal` to cancel.
   */
  planRoles(params: VideoRemakePlanRolesParams, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<VideoRemakePlannedRoles> {
    const body = {
      videoUrl: params.videoUrl,
      ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
      images: params.images,
      ...(params.engine !== undefined ? { engine: params.engine } : {}),
      ...(params.roles !== undefined ? { roles: params.roles } : {}),
      ...(params.references !== undefined ? { references: params.references } : {}),
      ...(params.preview !== undefined ? { preview: params.preview } : {}),
      ...(params.previewStart !== undefined ? { previewStart: params.previewStart } : {}),
      ...(params.portionStart !== undefined ? { portionStart: params.portionStart } : {}),
      ...(params.portionSec !== undefined ? { portionSec: params.portionSec } : {}),
      ...(params.clipKind !== undefined ? { clipKind: params.clipKind } : {}),
      ...(params.previz !== undefined ? { previz: params.previz } : {}),
    }
    return this.client.request("POST", "/v1/video-remake/plan-roles", {
      body,
      timeoutMs: options.timeoutMs ?? PLAN_ROLES_TIMEOUT_MS,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    })
  }

  /**
   * The art styles Video Remake's art style picker offers
   * (`GET /v1/video-remake/art-styles`), in the picker's order: each with its
   * `id` (a run's `direction.style`), its name in `locale` (a Nodaro language
   * id such as `"he"`, `"ja"`, `"ko"` or `"pt-BR"`; English when left out,
   * for a language Nodaro does not have, and for a style the language does
   * not name) and its preview, a clip and a still cut from it. The list is
   * empty where there is nothing to offer: a deployment that does not show
   * Nodaro's previews, or one without Video Remake or its art styles. It
   * lists what the picker shows; whether a run takes an art style on an
   * engine is {@link styleChoice}'s to say.
   * Public (no sign-in needed); the answer may be up to five minutes old.
   */
  async artStyles(params: { locale?: string } = {}): Promise<VideoRemakeArtStyle[]> {
    const query: Record<string, string> = {}
    if (params.locale) query.locale = params.locale
    const res = await this.client.request<{ data: VideoRemakeArtStyle[] }>("GET", "/v1/video-remake/art-styles", { query })
    return res.data
  }

  /**
   * Video Remake's before-and-after previews (`GET /v1/video-remake/previews`),
   * in the order Nodaro's pages show them: each with its clips, two stills cut
   * from them, its title and caption in `locale` (a Nodaro language id such as
   * `"he"`, `"ja"`, `"ko"` or `"pt-BR"`; English when left out, for a language
   * Nodaro does not have, and where the language has no copy for a preview)
   * and the tools-site page it leads to. The list is empty where there is
   * nothing to show: a deployment that does not show Nodaro's previews, or one
   * without Video Remake.
   * Public (no sign-in needed); the answer may be up to five minutes old.
   */
  async previews(params: { locale?: string } = {}): Promise<VideoRemakePreview[]> {
    const query: Record<string, string> = {}
    if (params.locale) query.locale = params.locale
    const res = await this.client.request<{ data: VideoRemakePreview[] }>("GET", "/v1/video-remake/previews", { query })
    return res.data
  }

  /**
   * Check, before a run, whether the words a person typed (`prePrompt`,
   * `postPrompt`, a custom style) ask for something Video Remake does
   * (`POST /v1/video-remake/intent`). Takes the same body as {@link estimate}
   * and {@link run}; answers {@link VideoRemakeIntentCheck}. Free: no job, no
   * credits, nothing kept. It never refuses a run: when it answers
   * `fits: false` you may show the person what the `code` says and let them
   * go on, then send `intent: { code, action: "continued" }` on the run.
   *
   * Treat `checked: false`, an error, a timeout and an unknown `code` as
   * "go ahead". Only where the deployment has the check switched on (it
   * answers `checked: false` elsewhere). Signed in; 12 calls a minute per
   * account (429 `rate_limit_exceeded`, with `Retry-After`). Waits 10 s by
   * default; pass `options.timeoutMs` for another wait and `options.signal`
   * to cancel.
   */
  intent(params: VideoRemakeParams, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<VideoRemakeIntentCheck> {
    return this.client.request("POST", "/v1/video-remake/intent", {
      body: params,
      timeoutMs: options.timeoutMs ?? INTENT_TIMEOUT_MS,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    })
  }

  /** Quote a run before starting it (`POST /v1/video-remake/estimate`); spends nothing. */
  async estimate(params: VideoRemakeParams): Promise<VideoRemakeEstimate> {
    const quote = await this.client.request<VideoRemakeEstimate>("POST", "/v1/video-remake/estimate", { body: params })
    // A Flash choice is answered as it is (never read as its engine).
    if (videoRemakeFlashEngineFrom(quote?.engine)) return quote
    // An older server names the engine by an earlier id: answered as the public id it names.
    const engine = nodaroMotionEngineFrom(quote?.engine)
    return engine && engine !== quote.engine ? { ...quote, engine } : quote
  }

  /**
   * Quote finishing a run at Full Quality (`POST
   * /v1/video-remake/:jobId/full-quality/estimate`); spends nothing. `jobId` is a
   * finished Nodaro Prism DRAFT run (a Video Remake or trend run made
   * with `draft: true`), whose same take Full Quality finishes at 1080p. The
   * quote does not look for a Full Quality already running: when one is,
   * {@link fullQuality} answers it (`existing: true`) and charges nothing.
   * Refusals: {@link VideoRemakeFullQualityRefusalCode}.
   */
  fullQualityEstimate(jobId: string): Promise<VideoRemakeFullQualityEstimate> {
    return this.client.request("POST", `/v1/video-remake/${encodeURIComponent(jobId)}/full-quality/estimate`, { body: {} })
  }

  /**
   * Finish a run at Full Quality (`POST /v1/video-remake/:jobId/full-quality`):
   * at 1080p, with the clip's audio, as a new job linked to the run — a
   * Nodaro Prism draft's own take re-rendered. SPENDS CREDITS: quote it first with
   * {@link fullQualityEstimate}. Answers 202 `{ jobId }`, or 200
   * `{ jobId, existing: true }` when this run's Full Quality is already
   * running or done (one per run; a failed one may be asked again). Follow
   * the job with `client.jobs.get(jobId)`. No `Idempotency-Key` is taken: the
   * server keys the job by the draft. The new job keeps the draft's origin.
   * Refusals: {@link VideoRemakeFullQualityRefusalCode}.
   */
  fullQuality(jobId: string, params: VideoRemakeFullQualityParams = {}): Promise<VideoRemakeFullQualityResult> {
    const body = params.sessionId !== undefined ? { sessionId: params.sessionId } : {}
    return this.client.request("POST", `/v1/video-remake/${encodeURIComponent(jobId)}/full-quality`, { body })
  }

  /**
   * A finished run's original clip and its result in one video (`POST
   * /v1/video-remake/:jobId/side-by-side`): the exact stretch of the clip the
   * run was made from beside the result, the result's sound, small
   * "Original" / "Remake" labels; stacked for a wide run, side by side for a
   * square or tall one. Each half is the result's size, up to a 1080p
   * picture's pixels (a larger result, such as a 4K one, is scaled down to
   * that, its shape kept; `width` / `height` are the file's). Free. The first call starts the render and answers
   * `making` (or `waiting`); call again every few seconds until it answers
   * `ready` with the file's address. A run whose file is made answers `ready`
   * at once. Your own runs only; a developer app's token needs `jobs:read`
   * and a `:write` or `:execute` scope (403 `insufficient_scope`). Refusals: 409 `side_by_side_unavailable`
   * (`reason`: `not_video_remake`, `not_finished`, `trend_run`, `no_clip`);
   * 500 `side_by_side_failed` (ask again later).
   */
  async sideBySide(jobId: string): Promise<VideoRemakeSideBySide> {
    const res = await this.client.request<{ data: VideoRemakeSideBySide }>("POST", `/v1/video-remake/${encodeURIComponent(jobId)}/side-by-side`, { body: {} })
    return res.data
  }
}

// ---------------------------------------------------------------------------
// The names this resource had before (`client.castSwap`, `CastSwap*`): the
// same resource and the same types, kept so code written against them still
// builds.
// ---------------------------------------------------------------------------

/** @deprecated use {@link VideoRemakeResource} (`client.videoRemake`). */
export const CastSwapResource = VideoRemakeResource
/** @deprecated use {@link VideoRemakeResource} (`client.videoRemake`). */
export type CastSwapResource = VideoRemakeResource
/** @deprecated use {@link VideoRemakeEngine}. */
export type CastSwapEngine = VideoRemakeEngine
/** @deprecated use {@link VideoRemakeEngine}. */
export type CastSwapEngineLegacyId = VideoRemakeEngineLegacyId
/** @deprecated use {@link VideoRemakeStyle}. */
export type CastSwapStyle = VideoRemakeStyle
/** @deprecated use {@link VideoRemakeMotionLength}. */
export type CastSwapMotionLength = VideoRemakeMotionLength
/** @deprecated use {@link VideoRemakeMotionLength}. */
export type CastSwapKlingLength = VideoRemakeMotionLength
/** @deprecated use {@link VideoRemakeTraitSource}. */
export type CastSwapTraitSource = VideoRemakeTraitSource
/** @deprecated use {@link VideoRemakeRolePreviewSettings}. */
export type CastSwapRolePreviewSettings = VideoRemakeRolePreviewSettings
/** @deprecated use {@link VideoRemakePersonRole}. */
export type CastSwapPersonRole = VideoRemakePersonRole
/** @deprecated use {@link VideoRemakeLocationRole}. */
export type CastSwapLocationRole = VideoRemakeLocationRole
/** @deprecated use {@link VideoRemakePetRole}. */
export type CastSwapPetRole = VideoRemakePetRole
/** @deprecated use {@link VideoRemakeProductRole}. */
export type CastSwapProductRole = VideoRemakeProductRole
/** @deprecated use {@link VideoRemakeRole}. */
export type CastSwapRole = VideoRemakeRole
/** @deprecated use {@link VideoRemakeReference}. */
export type CastSwapReference = VideoRemakeReference
/** @deprecated use {@link VideoRemakeFaceMaskingZone}. */
export type CastSwapFaceMaskingZone = VideoRemakeFaceMaskingZone
/** @deprecated use {@link VideoRemakeFaceMasking}. */
export type CastSwapFaceMasking = VideoRemakeFaceMasking
/** @deprecated use {@link VideoRemakeParams}. */
export type CastSwapParams = VideoRemakeParams
/** @deprecated use {@link VideoRemakeEstimate}. */
export type CastSwapEstimate = VideoRemakeEstimate
/** @deprecated use {@link VideoRemakeRunOptions}. */
export type CastSwapRunOptions = VideoRemakeRunOptions
/** @deprecated use {@link VideoRemakeFullQualityKind}. */
export type CastSwapFullQualityKind = VideoRemakeFullQualityKind
/** @deprecated use {@link VideoRemakeFullQualityEstimate}. */
export type CastSwapFullQualityEstimate = VideoRemakeFullQualityEstimate
/** @deprecated use {@link VideoRemakeFullQualityParams}. */
export type CastSwapFullQualityParams = VideoRemakeFullQualityParams
/** @deprecated use {@link VideoRemakeFullQualityResult}. */
export type CastSwapFullQualityResult = VideoRemakeFullQualityResult
/** @deprecated use {@link VideoRemakeFullQualityRefusalCode}. */
export type CastSwapFullQualityRefusalCode = VideoRemakeFullQualityRefusalCode
/** @deprecated use {@link VideoRemakeStyleChoiceOption}. */
export type CastSwapStyleChoiceOption = VideoRemakeStyleChoiceOption
/** @deprecated use {@link VideoRemakeStyleChoice}. */
export type CastSwapStyleChoice = VideoRemakeStyleChoice
