// The recordings of `nodaro edit`'s use-case node commands (decided
// 2026-10-19): `--media` (repeat it for the cameras of one conversation),
// `--master-audio` and the Cameras flags (`--wide-camera`, `--synced`,
// `--speaker-camera`), parsed into the SDK's recordings input. One helper so
// every use-case command that takes several recordings (Tighten Episode, Trailer)
// words and checks them the same way. The server is the gate on how many
// recordings a run takes and on who may run several (Speaker Map).
import type { Command } from "commander"
import type { UseCaseRecordingsInput } from "@nodaro/sdk/edit"
import { warn } from "../output.js"
import { collectVariadic } from "../util.js"

/** What commander hands the action for the recordings flags. */
export interface RecordingsOpts {
  media: string[]
  masterAudio?: string
  wideCamera?: string
  synced?: boolean
  speakerCamera?: string[]
}

/** Adds the recordings flags to a use-case command (`--media` required, repeatable). */
export function withRecordingsOptions(cmd: Command): Command {
  return cmd
    .requiredOption(
      "--media <url>",
      "the recording (video or audio URL, up to 3 hours); repeat it for the cameras of one conversation, in order (several need Speaker Map)",
      collectVariadic,
    )
    .option("--master-audio <url>", "the mixer or recorder track: the episode's sound and the clock the recordings are lined up to (needs Speaker Map)")
    .option("--wide-camera <n>", "with several recordings: which --media (1-based) is the wide shot")
    .option("--synced", "with several recordings: they already share one clock, skip lining them up")
    .option(
      "--speaker-camera <speaker=recording>",
      "with several recordings: put a speaker (1 = the first voice heard) on a --media number, 0 = the wide shot (repeatable)",
      collectVariadic,
    )
}

const WHOLE = /^\d+$/

/** The recordings input for the SDK, or exit 1 (before any request) on a flag it cannot take. */
export function recordingsInput(opts: RecordingsOpts): UseCaseRecordingsInput {
  const several = opts.media.length > 1 || opts.masterAudio !== undefined
  const cameraFlags = opts.wideCamera !== undefined || opts.synced === true || (opts.speakerCamera?.length ?? 0) > 0
  if (cameraFlags && !several) {
    warn("--wide-camera, --synced and --speaker-camera apply with several --media or --master-audio only")
    process.exit(1)
  }
  let wide: number | undefined
  if (opts.wideCamera !== undefined) {
    if (!WHOLE.test(opts.wideCamera) || Number(opts.wideCamera) < 1) {
      warn(`--wide-camera must be a recording number, 1 or more (got "${opts.wideCamera}")`)
      process.exit(1)
    }
    wide = Number(opts.wideCamera)
  }
  const speakerCameras: Record<string, number> = {}
  for (const pair of opts.speakerCamera ?? []) {
    const [speaker, recording, ...extra] = pair.split("=")
    if (extra.length > 0 || !speaker || !recording || !WHOLE.test(speaker) || !WHOLE.test(recording) || Number(speaker) < 1) {
      warn(`--speaker-camera must be <speaker>=<recording>: a speaker 1 or more, a --media number or 0 for the wide shot (got "${pair}")`)
      process.exit(1)
    }
    const key = String(Number(speaker))
    if (key in speakerCameras) {
      warn(`--speaker-camera names speaker ${key} twice`)
      process.exit(1)
    }
    speakerCameras[key] = Number(recording)
  }
  const cameras = {
    ...(wide !== undefined ? { wide } : {}),
    ...(opts.synced ? { synced: true } : {}),
    ...(Object.keys(speakerCameras).length > 0 ? { speakerCameras } : {}),
  }
  return {
    // One --media is the one-recording request it always was.
    ...(opts.media.length === 1 ? { mediaUrl: opts.media[0]! } : { mediaUrls: [...opts.media] }),
    ...(opts.masterAudio !== undefined ? { masterAudioUrl: opts.masterAudio } : {}),
    ...(Object.keys(cameras).length > 0 ? { cameras } : {}),
  }
}
