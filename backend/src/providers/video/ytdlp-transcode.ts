/**
 * Which yt-dlp runs RE-ENCODE (round 3 of #1860, decided 2026-10-05).
 *
 * yt-dlp starts its own ffmpeg: as a downloader (a section cut), as a
 * post-processor (audio conversion, recode, a cut by chapter) and for stills
 * (a thumbnail). That child is not the backend's launcher, so left alone it carries
 * no thread counts and no memory reservation — the 4K OOM again, from a lane the
 * admission could not see. A run that may ENCODE is admitted like any ffmpeg
 * (`ytdlp-admission.ts`), told the quota's thread counts and reserved what it
 * requested (`ytdlp-ffmpeg-limits.ts`); a run that only copies streams, or
 * converts one still, is exempt.
 *
 * Pure and dependency-free: one classifier over the flags, whichever way the
 * run is spelled (an argv, or `youtube-dl-exec`'s options object).
 *
 * TRANSCODES — each row is a combination that makes yt-dlp's ffmpeg encode:
 *   --force-keyframes-at-cuts + a cut (--download-sections, --remove-chapters,
 *     --sponsorblock-remove, --split-chapters)   re-encodes the video at the cuts
 *   --recode-video / --recode                    re-encodes into another format
 *   --extract-audio + --audio-format <not best>  encodes the audio (mp3, opus, ...)
 *   --postprocessor-args / --ppa                 arbitrary ffmpeg arguments
 *   --downloader-args / --external-downloader-args   arbitrary ffmpeg arguments
 * Arbitrary ffmpeg arguments cannot be shown to copy, so they count as encoding.
 *
 * EXEMPT — stream copy, or one still image:
 *   --merge-output-format, --remux-video, --embed-subs/-metadata/-chapters,
 *   --fixup                          mux with `-c copy`
 *   --download-sections alone, --remove-chapters alone   cut with `-c copy`
 *   --extract-audio alone / --audio-format best          the source's own stream
 *   --convert-thumbnails, --embed-thumbnail   ffmpeg converts ONE still image
 *   --convert-subs                   rewrites subtitle text
 *   --dump-json, --print, --skip-download     no ffmpeg at all
 */

/** Flags (and their short forms) normalized to one spelling. */
const ALIASES: Readonly<Record<string, string>> = {
  "-x": "--extract-audio",
  "--recode": "--recode-video",
  "--ppa": "--postprocessor-args",
  "-f": "--format",
}

/** A token that is a flag, not a value (a value may merely CONTAIN a flag's name). */
const FLAG = /^--?[A-Za-z][\w-]*(=|$)/

/** The flags of an argv, normalized, with the value each carries (`true` for none). */
export function parseFlags(args: readonly string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>()
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!
    if (!FLAG.test(token)) continue
    const eq = token.indexOf("=")
    const name = eq < 0 ? token : token.slice(0, eq)
    const key = ALIASES[name] ?? name
    if (eq >= 0) {
      flags.set(key, token.slice(eq + 1))
      continue
    }
    const next = args[i + 1]
    if (next !== undefined && !FLAG.test(next)) {
      flags.set(key, next)
      i++
    } else {
      flags.set(key, true)
    }
  }
  return flags
}

export const CUTS = ["--download-sections", "--remove-chapters", "--sponsorblock-remove", "--split-chapters"] as const

/**
 * Why this run may re-encode, or undefined when it only copies streams (or
 * converts one still image, or runs no ffmpeg at all).
 */
export function ytDlpTranscodeReason(args: readonly string[]): string | undefined {
  const flags = parseFlags(args)
  if (flags.has("--force-keyframes-at-cuts")) {
    const cut = CUTS.find((flag) => flags.has(flag))
    if (cut) return `${cut} with --force-keyframes-at-cuts re-encodes the video at the cuts`
  }
  if (flags.has("--recode-video")) return "--recode-video re-encodes into another format"
  if (flags.has("--extract-audio")) {
    const format = flags.get("--audio-format")
    if (typeof format === "string" && format.trim().toLowerCase() !== "best") {
      return `--extract-audio to ${format} encodes the audio`
    }
  }
  for (const flag of ["--postprocessor-args", "--downloader-args", "--external-downloader-args"]) {
    if (flags.has(flag)) return `${flag} hands ffmpeg arbitrary arguments, which cannot be shown to copy`
  }
  return undefined
}

/**
 * `youtube-dl-exec`'s options object as the argv it makes of it — the same
 * spelling its `dargs` gives (`useEquals: false`), so a run keeps its flags
 * whichever way it is launched and the classifier reads what yt-dlp is given:
 * camelCase keys become `--kebab-case`, a ONE-LETTER key is a short flag (`x`
 * gives `-x`), `true` is the bare flag, `false` is `--no-<key>`, nullish values
 * are dropped, an array repeats the flag. A test holds it equal to
 * `youtubedl.args` for the lanes' options and for the cases that differ.
 */
export function ytDlpOptionsToArgs(options: Readonly<Record<string, unknown>>): string[] {
  const args: string[] = []
  const spell = (key: string): string =>
    key.length === 1 ? `-${key}` : `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null) continue
    if (value === false) {
      args.push(spell(`no-${key}`))
      continue
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === true) args.push(spell(key))
      else if (item !== undefined && item !== null && item !== false) args.push(spell(key), String(item))
    }
  }
  return args
}
