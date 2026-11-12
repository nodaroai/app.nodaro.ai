import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"

/**
 * The arguments a workflow video lane builds its credit id from — the seven
 * values `buildVideoCreditModelIdentifier` takes, as plain data. The aspect
 * ratio is not one of them: it is not a pricing input of these lanes.
 *
 * Plain data on purpose: a build result carries it (`PayloadResult
 * .videoCreditIdArgs`), and a build result must stay safe to clone and to
 * compare.
 */
export interface VideoCreditIdArgs {
  /** The model the run is sent to (the lane's resolved provider). */
  readonly provider: string
  /** The length the lane prices: a number, a numeric string, `-1` (Auto) or absent. */
  readonly duration: number | string | undefined
  readonly sound: boolean | undefined
  /** The job's mode. */
  readonly mode: "image-to-video" | "text-to-video"
  /** The fifth argument: the lane's own pick of size or quality mode. */
  readonly sizeOrMode: string | undefined
  readonly resolution: string | undefined
  /** A reference video (or a soundtrack sent as one) rides the run. */
  readonly hasVideoRef: boolean
}

/**
 * A video lane's credit id from its arguments. The ONE builder for both the
 * payload builder's lanes and the node executor, which re-prices a run whose
 * length the reference task type moved (lib/seedance-task-type-stamp.ts) — so
 * the two can only differ by the length.
 */
export function videoCreditIdOf(args: VideoCreditIdArgs): string {
  return buildVideoCreditModelIdentifier(
    args.provider,
    args.duration,
    args.sound,
    args.mode,
    args.sizeOrMode,
    args.resolution,
    args.hasVideoRef,
  )
}
