// @reads-none reads only the local media inputs and lists a plugin's ffmpeg run names (its work-dir paths), never a repo file
/**
 * What a private plugin's ffmpeg or ffprobe run (the toolkit's runners,
 * `plugin-run-guard.ts`) may name besides a link it reads through the probe
 * guard: the rules for its local inputs. Measured on the pinned n8.1.2:
 *
 * - A local file input opens nothing but `file`, `crypto` and `data` from what
 *   it names (ffmpeg's inherited whitelist), so a local concat list, playlist
 *   or manifest naming a link fails on its own. A caller's own
 *   `-protocol_whitelist` naming a network protocol lifts that
 *   (`whitelistWidens`).
 * - An input read through another protocol has no such whitelist: `-i
 *   cache:list.m3u8` and `-i async:list.m3u8` open every link the list names,
 *   and `unix:/path` connects to a local socket. So a local input is a plain
 *   path, `file:`, `pipe:` or `fd:` only (`inputProtocolOf`).
 * - A local input that is a list (forced with `-f concat`/`hls`/`dash`/…, or
 *   one whose first bytes say so) is read and held to the link rule as well,
 *   so a list naming a link is refused before ffmpeg starts
 *   (`localListProblem`).
 */
import { linkRuleText, namesALink, OPTION_FILE_MAX_BYTES, plainFileBytes } from "./link-arguments.js"
import { openSync, readSync, closeSync, statSync } from "node:fs"

/**
 * Every protocol name an ffmpeg build may know (`ffmpeg -protocols` on the
 * pinned n8.1.2 and on 9, plus the ones optional libraries add). An argument
 * spelled `<one of these>:…` is read through that protocol.
 */
export const KNOWN_PROTOCOLS: ReadonlySet<string> = new Set([
  "android_content", "async", "bluray", "cache", "concat", "concatf", "crypto", "data", "dtls", "fd", "ffrtmpcrypt", "ffrtmphttp",
  "file", "ftp", "gopher", "gophers", "hls", "http", "httpproxy", "https", "icecast", "ipfs", "ipns", "librist", "librtmp",
  "librtmpe", "librtmps", "librtmpt", "librtmpte", "libsmbclient", "libsrt", "libssh", "libzmq", "md5", "mmsh", "mmst", "pipe",
  "prompeg", "rist", "rtmp", "rtmpe", "rtmps", "rtmpt", "rtmpte", "rtmpts", "rtp", "sctp", "sftp", "shared", "smb", "srt", "srtp",
  "subfile", "tcp", "tee", "tls", "udp", "udplite", "unix", "zmq",
])

/** The protocols a plugin's local input may be read through: a plain file, and the run's own pipes. */
const LOCAL_INPUT_PROTOCOLS: ReadonlySet<string> = new Set(["file", "pipe", "fd"])

/**
 * The protocols a caller's `-protocol_whitelist` may name on a run that reads
 * no link: ones that never reach the network themselves (the whitelist is
 * then what holds everything an input names, wrappers included).
 */
const LOCAL_WHITELIST_PROTOCOLS: ReadonlySet<string> = new Set(["file", "pipe", "fd", "crypto", "data", "subfile", "concat", "concatf", "cache", "async"])

/** `<scheme>:` as ffmpeg reads a protocol prefix (letters, digits, `+`, `-`, `.`), or `subfile,`. */
const SCHEME = /^([A-Za-z0-9+.-]*):/

/**
 * The protocol `value` is read through when it is not a plain path: its scheme
 * as written (lowercase), `subfile` for the `subfile,` form, or undefined for
 * a plain path. A value starting with `-` is an option, never a protocol.
 */
export function protocolOf(value: string): string | undefined {
  if (value.startsWith("subfile,")) return "subfile"
  if (value.startsWith("-")) return undefined
  const m = SCHEME.exec(value)
  return m ? m[1]!.toLowerCase() : undefined
}

/**
 * The protocol a plugin's LOCAL input (an `-i` value with no link, ffprobe's
 * input, a `movie=` source) is refused for, or undefined when it is a plain
 * path, `file:`, `pipe:` or `fd:`.
 */
export function inputProtocolRefused(value: string): string | undefined {
  const protocol = protocolOf(value)
  return protocol === undefined || LOCAL_INPUT_PROTOCOLS.has(protocol) ? undefined : protocol || "(empty)"
}

/**
 * A known protocol any argument of a plugin's run names other than a plain
 * file or the run's pipes (`unix:/run/x.sock` as an output, `cache:` as an
 * ffprobe input), or undefined. Only known names count, so a value such as
 * `v:0` or `16:9` is never one.
 */
export function knownProtocolRefused(arg: string): string | undefined {
  const protocol = protocolOf(arg)
  return protocol !== undefined && KNOWN_PROTOCOLS.has(protocol) && !LOCAL_INPUT_PROTOCOLS.has(protocol) ? protocol : undefined
}

/**
 * The first protocol a `-protocol_whitelist` value names that can reach the
 * network (anything but a local one), or undefined. A name ffmpeg would not
 * know is counted too: the list is held to local protocols only.
 */
export function whitelistWidens(value: string): string | undefined {
  return value
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .find((p) => p !== "" && !LOCAL_WHITELIST_PROTOCOLS.has(p))
}

/** The demuxers that read a list of other inputs: a local file forced to one is read as a list. */
export const LIST_DEMUXERS: ReadonlySet<string> = new Set(["concat", "hls", "applehttp", "dash", "imf", "webm_dash_manifest"])

/** How much of a local input is read to tell a list from a media file. */
const SNIFF_BYTES = 4096

/** The first bytes of `path` when it is a regular file, else undefined. */
function headOf(path: string): Buffer | undefined {
  let fd: number | undefined
  try {
    if (!statSync(path).isFile()) return undefined
    fd = openSync(path, "r")
    const buf = Buffer.alloc(SNIFF_BYTES)
    return buf.subarray(0, readSync(fd, buf, 0, SNIFF_BYTES, 0))
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Whether a file's first bytes are those of a list ffmpeg probes as one: an
 * HLS playlist (`#EXTM3U`), an ffconcat script, a DASH manifest (`<MPD`) or an
 * IMF composition playlist.
 */
function looksLikeList(head: Buffer): boolean {
  const text = linkRuleText(head).replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart()
  return text.startsWith("#EXTM3U") || text.startsWith("ffconcat version") || /<(?:[\w-]+:)?(?:MPD|CompositionPlaylist)\b/.test(text)
}

/**
 * What is wrong with a plugin's local input as a list: undefined when it is no
 * list (a media file, a missing path or a pipe, for ffmpeg itself to open), or
 * a list that names no link; `names a link` when it is a list that names one;
 * `unreadable` when a list (forced with `-f <list demuxer>`, or recognised by
 * its first bytes) cannot be read whole to be checked (larger than
 * `OPTION_FILE_MAX_BYTES`, or not a regular file).
 */
export function localListProblem(path: string, forcedFormat?: string): "names a link" | "unreadable" | undefined {
  const local = path.startsWith("file:") ? path.slice("file:".length) : path
  if (protocolOf(local) !== undefined) return undefined // pipe:/fd: — nothing on disk to read
  const forced = forcedFormat !== undefined && LIST_DEMUXERS.has(forcedFormat.toLowerCase())
  if (!forced) {
    const head = headOf(local)
    if (!head || !looksLikeList(head)) return undefined
  }
  const bytes = plainFileBytes(local, OPTION_FILE_MAX_BYTES)
  if (!bytes) return "unreadable"
  return namesALink(linkRuleText(bytes)) ? "names a link" : undefined
}
