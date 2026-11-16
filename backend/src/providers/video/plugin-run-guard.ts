// @reads-none reads only the option files, local inputs and filter files a plugin's ffmpeg run names (its work-dir paths), never a repo file
/**
 * Everything a private plugin's ffmpeg or ffprobe run (the toolkit's
 * `runFfmpeg`, `runFfmpegCapture` and `runFfprobe`) is checked for besides a
 * link it reads through the probe guard (`ffmpeg-reading-links.ts`,
 * `runFfprobeReadingLinks`). Before the binary starts, and on every run:
 *
 * 1. A file an option reads its value from (`-/filter_complex <file>`,
 *    `-filter_complex_script`, ffprobe's `-/i`, the lavfi device's
 *    `-graph_file`…) is read ONCE, held to the link rule, and the run is
 *    handed that exact copy (a private temp file, removed after): what was
 *    checked is what ffmpeg reads, whatever happens to the plugin's file in
 *    between.
 * 2. A run that reads no link may not widen what a local input opens: a
 *    `-protocol_whitelist` naming a network protocol is refused
 *    (`whitelistWidens`; with it, a local concat list or playlist opens the
 *    links it names, measured on the pinned 8.1.2).
 * 3. No argument is read through a known protocol other than a plain file or
 *    the run's pipes (`cache:`, `async:`, `unix:`…), and a local input is a
 *    plain path, `file:`, `pipe:` or `fd:` only (`plugin-inputs.ts`).
 * 4. A local input that is a list is held to the link rule (`localListProblem`).
 * 5. Every filter graph the run builds (inline, from an option's file, a lavfi
 *    input) is read for the files its filters open (`graphFileProblem`).
 *
 * Every refusal is a `ProbeSourceBlockedError` with reason `link`. Core
 * `runFfmpeg` is untouched: the host's own runs read local files it wrote.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { linkRuleText, namesALink, plainFileBytes, readsValueFromFile } from "./link-arguments.js"
import { graphFileProblem } from "./filtergraph-files.js"
import { inputProtocolRefused, knownProtocolRefused, localListProblem, whitelistWidens } from "./plugin-inputs.js"
import { ProbeSourceBlockedError } from "./probe-guard.js"

/** An inline option whose value is a filter graph (ffmpeg's `-vf`, `-af`, `-filter[:…]`, `-filter_complex`, `-lavfi`; the lavfi device's `-graph`). */
const GRAPH_OPTION = /^-(?:vf|af|filter(?::.*)?|filter_complex|lavfi|graph)$/
/** An option whose FILE holds a filter graph. */
const GRAPH_FILE_OPTION = /^-(?:\/(?:vf|af|filter(?::.*)?|filter_complex|lavfi|graph)|filter_complex_script|filter_script(?::.*)?|graph_file)$/
/** A caller's protocol whitelist, as written or from a file. */
const WHITELIST_OPTION = /^-\/?protocol_whitelist(?::.*)?$/

/** A plugin run's arguments once checked, with the private copies its option files are read from. */
export interface PreparedPluginRun {
  readonly argv: string[]
  /** Removes the private copies. */
  cleanup(): Promise<void>
}

const refuse = (tool: string, why: string): never => {
  throw new ProbeSourceBlockedError("link", `${tool}: blocked — ${why}`)
}

/**
 * Check a plugin run's arguments (module note) and give back the ones to run:
 * the same, with each option file's path replaced by its private copy.
 * `readsLink`: the run names a link (as written), whose own rules
 * (`guardedArgv`, `runFfprobeReadingLinks`) then apply to it.
 */
export async function preparePluginRun(args: readonly string[], tool: "ffmpeg" | "ffprobe", opts: { readonly readsLink: boolean }): Promise<PreparedPluginRun> {
  const argv = [...args]
  let dir: string | undefined
  const cleanup = async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  }
  try {
    // 1. Option files: read once, checked, copied.
    const fileTexts = new Map<number, string>()
    for (let i = 0; i < args.length; i++) {
      if (!readsValueFromFile(args[i]!)) continue
      const bytes = args[i + 1] === undefined ? undefined : plainFileBytes(args[i + 1]!)
      if (!bytes) refuse(tool, `${args[i]} reads its value from something that is not a readable local file, so it cannot be checked for links`)
      const text = linkRuleText(bytes!)
      if (namesALink(text)) refuse(tool, `the file ${args[i]} reads names a link; a link may only be read as an input (-i <link>)`)
      dir ??= await mkdtemp(join(tmpdir(), "nodaro-plugin-run-"))
      const copy = join(dir, `${fileTexts.size}.value`)
      await writeFile(copy, bytes!, { mode: 0o600, flag: "wx" })
      fileTexts.set(i, text)
      argv[i + 1] = copy
      i++
    }

    const graphs: string[] = []
    const inputs: Array<{ readonly value: string; readonly forced?: string }> = []
    const lavfiProbe = tool === "ffprobe" && args.some((a, i) => a === "-f" && args[i + 1] === "lavfi")
    let format: string | undefined
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!
      if (fileTexts.has(i)) {
        if (GRAPH_FILE_OPTION.test(a)) graphs.push(fileTexts.get(i)!)
        // ffprobe's input read from a file is an input like any other.
        if (a === "-/i") inputs.push({ value: fileTexts.get(i)!, ...(format ? { forced: format } : {}) })
        if (WHITELIST_OPTION.test(a) && !opts.readsLink) {
          const wide = whitelistWidens(fileTexts.get(i)!)
          if (wide) refuse(tool, `${a} names ${wide}, which lets a local input open links; a link may only be read as an input (-i <link>)`)
        }
        i++
        continue
      }
      const value = args[i + 1]
      if (GRAPH_OPTION.test(a) && value !== undefined) graphs.push(value)
      if (WHITELIST_OPTION.test(a) && value !== undefined && !opts.readsLink) {
        const wide = whitelistWidens(value)
        if (wide) refuse(tool, `${a} names ${wide}, which lets a local input open links; a link may only be read as an input (-i <link>)`)
      }
      if (a === "-f" && value !== undefined) format = value
      if (a === "-i" && value !== undefined) {
        // ffmpeg reads the options before an -i for that input alone.
        if (format === "lavfi") graphs.push(value)
        else inputs.push({ value, ...(format ? { forced: format } : {}) })
        format = undefined
      }
      // ffprobe takes its input anywhere among its options; with -f lavfi it is a graph.
      if (tool === "ffprobe" && !a.startsWith("-")) {
        if (lavfiProbe) graphs.push(a)
        else inputs.push({ value: a, ...(format ? { forced: format } : {}) })
      }
      // 3. No argument through a protocol other than a file or the run's pipes (a link is the link rule's).
      if (!namesALink(a)) {
        const protocol = knownProtocolRefused(a)
        if (protocol) refuse(tool, `an argument is read through the ${protocol} protocol, which can open links or sockets; a local input is a plain file path`)
      }
    }

    // 3–4. Local inputs: a plain path, file:, pipe: or fd: only; a list held to the link rule.
    for (const { value, forced } of inputs) {
      if (namesALink(value)) continue
      const protocol = inputProtocolRefused(value)
      // An ffprobe argument that is not its input (an option's value) reads nothing: only a known protocol counts there.
      if (protocol && (tool === "ffmpeg" || knownProtocolRefused(value))) {
        refuse(tool, `a local input is read through the ${protocol} protocol, which can open the links it names; a local input is a plain file path`)
      }
      const list = localListProblem(value, forced)
      if (list === "names a link") refuse(tool, "a local input is a list (a concat script, a playlist or a manifest) that names a link; a link may only be read as an input (-i <link>)")
      if (list === "unreadable") refuse(tool, "a local input is a list that cannot be read whole, so it cannot be checked for links")
    }

    // 5. The files the filters of every graph read.
    for (const graph of graphs) {
      const found = graphFileProblem(graph)
      if (!found) continue
      const { filter, problem } = found
      if (problem === "names a link") refuse(tool, `the file the ${filter} filter reads names a link; a link may only be read as an input (-i <link>)`)
      if (problem === "unreadable") refuse(tool, `the file the ${filter} filter reads cannot be read whole, so it cannot be checked for links`)
      if (problem === "protocol") refuse(tool, `the ${filter} filter reads its source through a protocol other than a plain file, which can open the links it names`)
      refuse(tool, `the ${filter} filter's format_opts sets the probe guard's own options`)
    }
    return { argv, cleanup }
  } catch (err) {
    await cleanup()
    throw err
  }
}

/**
 * The refusal of a plugin's local input (a path a toolkit member probes or
 * encodes), by the rules of a run's `-i` (3–4 above); undefined when it may be
 * read, and for a link, which the member's own link rule answers.
 */
export function pluginLocalInputRefusal(path: string, tool: "ffmpeg" | "ffprobe"): ProbeSourceBlockedError | undefined {
  if (namesALink(path)) return undefined
  const protocol = inputProtocolRefused(path)
  if (protocol) return new ProbeSourceBlockedError("link", `${tool}: blocked — a local input is read through the ${protocol} protocol, which can open the links it names; a local input is a plain file path`)
  const list = localListProblem(path)
  if (list === "names a link") return new ProbeSourceBlockedError("link", `${tool}: blocked — a local input is a list (a concat script, a playlist or a manifest) that names a link; a link may only be read as an input (-i <link>)`)
  if (list === "unreadable") return new ProbeSourceBlockedError("link", `${tool}: blocked — a local input is a list that cannot be read whole, so it cannot be checked for links`)
  return undefined
}
