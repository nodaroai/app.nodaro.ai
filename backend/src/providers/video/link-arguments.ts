// @reads-none reads only the file an ffmpeg or ffprobe option is handed to take its value from (a caller's work-dir path), never a repo file
/**
 * Whether the arguments of an ffmpeg or ffprobe run name a link: the one rule
 * the probe guard (`probe-guard.ts`) and the toolkit's ffmpeg runners
 * (`ffmpeg-reading-links.ts`) read an argv by.
 *
 * A link can reach the binary three ways:
 * - written as it is (`https://…`, `isNetworkProbeSource`);
 * - inside a filter graph, in ffmpeg's filter escaping (`movie=http\://…`,
 *   `namesALink`);
 * - in a FILE an option reads its value from: any option written `-/<name>`
 *   (`-/filter_complex <file>`, `-/vf`, `-/af`, ffprobe's `-/i`, ffmpeg 7 and
 *   later), the older `-filter_complex_script` and `-filter_script[:<stream>]`
 *   (still in the pinned 8.1.2, gone from 9), and the lavfi device's
 *   `-graph_file <file>` (a filter graph). Such a file is read here and held to
 *   the inline rule (`optionFileProblem`).
 */
import { readFileSync, statSync } from "node:fs"

/** A probe input that names a network source (a local path never does). */
export function isNetworkProbeSource(src: string): boolean {
  return src.includes("://")
}

/**
 * Whether an argument names a link: as written, or once ffmpeg's filter
 * escaping is taken off. A filter argument reaches ffmpeg's filter parser,
 * which drops a backslash before any character and the single quotes around
 * a part (`movie=http\://…`, `movie='http'://…`), so a source filter such as
 * `movie` or `amovie` opens a link that is not written with a plain `://`.
 * Read the same way for every argument, so no option is missed; an argument
 * that is not a filter has no reason to spell a link that way.
 */
export function namesALink(arg: string): boolean {
  return isNetworkProbeSource(arg) || isNetworkProbeSource(arg.replace(/[\\']/g, ""))
}

/** The options whose value ffmpeg and ffprobe read from a file (module note). */
const VALUE_FROM_FILE = /^-(?:\/|filter_complex_script(?::|$)|filter_script(?::|$)|graph_file(?::|$))/

/** Whether `option` takes its value from a file (`-/filter_complex <file>`, `-filter_complex_script <file>`, …). */
export function readsValueFromFile(option: string): boolean {
  return VALUE_FROM_FILE.test(option)
}

/** The most a file an option reads its value from may hold to be checked; a larger one is refused. */
export const OPTION_FILE_MAX_BYTES = 16 * 1024 * 1024

/**
 * A value ffmpeg opens through a protocol rather than as a plain local path:
 * a scheme before a colon (`data:`, `file:`, `pipe:`, `cache:`, `C:`…) or a
 * `subfile,` prefix, as ffmpeg's own URL reading tells them apart. ffmpeg
 * reads an option's file through its I/O layer, so `-/filter_complex
 * data:…;base64,…` reads a graph no file here holds (measured on the pinned
 * 8.1.2).
 */
const PROTOCOL_PREFIX = /^(?:[A-Za-z0-9+.-]*:|subfile,)/

/**
 * The bytes of the plain local regular file `path` (at most `maxBytes`), or
 * undefined when it is not one this check can read: a protocol prefix, a
 * missing file, a directory, a FIFO or a device (a FIFO or a device would hold
 * the read, and the run, forever), or a larger file.
 */
export function plainFileBytes(path: string, maxBytes: number = OPTION_FILE_MAX_BYTES): Buffer | undefined {
  if (PROTOCOL_PREFIX.test(path)) return undefined
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > maxBytes) return undefined
    return readFileSync(path)
  } catch {
    return undefined
  }
}

/** A file's bytes as text for the link rule: latin1 keeps every byte as one character, so nothing a file spells is lost to decoding. */
export const linkRuleText = (bytes: Buffer): string => bytes.toString("latin1")

/** The text of the plain local file `path`, or undefined when it is not one this check can read. */
function optionFileText(path: string): string | undefined {
  const bytes = plainFileBytes(path)
  return bytes === undefined ? undefined : linkRuleText(bytes)
}

/**
 * What is wrong with the files the options of `args` read their values from,
 * the first one found: a file whose text names a link (`namesALink`), or a
 * value this check cannot read as a plain local regular file (missing, a
 * directory or a FIFO, larger than {@link OPTION_FILE_MAX_BYTES}, a protocol
 * such as `data:`). Undefined when every such file is readable and names no
 * link, or no option reads a file.
 */
export function optionFileProblem(args: readonly string[]): { readonly option: string; readonly problem: "names a link" | "unreadable" } | undefined {
  for (let i = 0; i < args.length; i++) {
    const option = args[i]!
    if (!readsValueFromFile(option)) continue
    const path = args[i + 1]
    const text = path === undefined ? undefined : optionFileText(path)
    if (text === undefined) return { option, problem: "unreadable" }
    if (namesALink(text)) return { option, problem: "names a link" }
    i++ // the value is a path, never an option of its own
  }
  return undefined
}
