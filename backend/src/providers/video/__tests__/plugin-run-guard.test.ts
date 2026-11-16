// @test-reads-none reads only the lists, filter files and option files it writes to its own temp dir
/**
 * A private plugin's ffmpeg or ffprobe run, besides a link it reads through
 * the probe guard (`plugin-run-guard.ts`, `plugin-inputs.ts`,
 * `filtergraph-files.ts`): no widened whitelist, no argument through a
 * protocol other than a plain file or the run's pipes, a local list and the
 * files the run's filters read held to the link rule, and each option file
 * read once and handed to the run as that copy. The real binaries' reads are
 * in `probe-guard.e2e.test.ts`.
 */
import { afterAll, describe, expect, it } from "vitest"
import { execFile, execFileSync } from "node:child_process"
import { promisify } from "node:util"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { avGetToken, FILTER_FILE_OPTIONS_NOT_READ, FILTER_FILE_OPTIONS_READ, filtersOf, graphFileProblem } from "../filtergraph-files.js"
import { inputProtocolRefused, KNOWN_PROTOCOLS, knownProtocolRefused, localListProblem, whitelistWidens } from "../plugin-inputs.js"
import { pluginLocalInputRefusal, preparePluginRun } from "../plugin-run-guard.js"

const dir = mkdtempSync(join(tmpdir(), "plugin-run-guard-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const file = (name: string, text: string | Buffer) => {
  writeFileSync(join(dir, name), text)
  return join(dir, name)
}
const LINK = "https://cdn.example/secret.mp4"
const refusal = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e as { reason?: string; message: string })

describe("a local input's protocol, and a caller's whitelist", () => {
  it("a local input is a plain path, file:, pipe: or fd: only", () => {
    for (const ok of ["/tmp/a.mp4", "a.mp4", "file:/tmp/a.mp4", "pipe:0", "fd:3", "/tmp/a:b.mp4", "./c:d.mp4"]) expect(inputProtocolRefused(ok), ok).toBeUndefined()
    for (const [value, protocol] of [["cache:/tmp/l.m3u8", "cache"], ["async:/tmp/l.m3u8", "async"], ["unix:/run/x.sock", "unix"], ["concat:a.mp4|b.mp4", "concat"], ["subfile,,start,0,end,9,,:/tmp/a", "subfile"], ["data:text/plain,x", "data"], ["crypto:/tmp/a", "crypto"]]) {
      expect(inputProtocolRefused(value!), value).toBe(protocol)
    }
  })

  it("any argument through a known protocol other than a file or the run's pipes; values such as v:0 or 16:9 are none", () => {
    for (const arg of ["unix:/run/docker.sock", "cache:x", "tcp:x", "udp:x", "subfile,,start,0,end,1,,:x", "tee:x"]) expect(knownProtocolRefused(arg), arg).toBeTruthy()
    for (const arg of ["v:0", "16:9", "0:v", "00:00:01.5", "-c:v", "movie=a.mp4[m];[0:v][m]overlay", "format=duration", "csv=p=0", "pipe:1", "file:/tmp/a", "/tmp/a.mp4"]) {
      expect(knownProtocolRefused(arg), arg).toBeUndefined()
    }
  })

  it("the known protocols cover every protocol the installed ffmpeg lists", () => {
    const listed = execFileSync("ffmpeg", ["-hide_banner", "-protocols"], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[a-z0-9_]+$/.test(l))
    expect(listed.length).toBeGreaterThan(10)
    expect(listed.filter((p) => !KNOWN_PROTOCOLS.has(p))).toEqual([])
  })

  it("a whitelist widens when it names anything but a local protocol", () => {
    expect(whitelistWidens("file")).toBeUndefined()
    expect(whitelistWidens("file,pipe")).toBeUndefined()
    expect(whitelistWidens(" file , crypto,data ")).toBeUndefined()
    expect(whitelistWidens("file,http,tcp")).toBe("http")
    expect(whitelistWidens("file,unix")).toBe("unix")
    expect(whitelistWidens("ALL")).toBe("all")
  })
})

describe("the file-reading filters are held to the installed ffmpeg (CI installs the pinned one)", () => {
  /** An option that names a file or a path: by its name, or by what ffmpeg says it is. */
  const FILEISH_NAME = /file|path|model|sofa|weights|psfile|\bdir\b|fontsdir|^f$|^m$|cover|object|hint|db\b|lut|shader|config|script/i
  const FILEISH_HELP = /\bfile\b|filename|\bpath\b|director/i

  it("every filter option that names a file is read by the check, or listed as not read, with why", async () => {
    const filters = execFileSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" })
      .split("\n")
      // ` TS name  V->V  description`: the flags, the name, its pads.
      .flatMap((l) => /^\s*[T.][S.][C.]?\s+(\S+)\s+\S+->\S+/.exec(l)?.[1] ?? [])
    expect(filters.length).toBeGreaterThan(100)
    const run = promisify(execFile)
    const found = new Set<string>()
    const queue = [...filters]
    await Promise.all(Array.from({ length: 16 }, async () => {
      for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
        const { stdout } = await run("ffmpeg", ["-hide_banner", "-h", `filter=${name}`], { maxBuffer: 1 << 24 })
        for (const line of stdout.split("\n")) {
          const m = /^\s{2,3}(\S+)\s+<(?:string|binary|dictionary)>\s+\S+\s*(.*)$/.exec(line)
          if (m && (FILEISH_NAME.test(m[1]!) || FILEISH_HELP.test(m[2]!))) found.add(`${name}.${m[1]}`)
        }
      }
    }))
    // The known ones are found at all (the census reads ffmpeg's help as it is printed).
    expect([...found]).toEqual(expect.arrayContaining(["lut3d.file", "movie.filename", "sendcmd.filename"]))
    const unlisted = [...found].filter((o) => !FILTER_FILE_OPTIONS_READ.has(o) && !(o in FILTER_FILE_OPTIONS_NOT_READ)).sort()
    expect(unlisted, "a filter option that names a file is neither read (FILE_READING_FILTERS) nor listed as not read (FILTER_FILE_OPTIONS_NOT_READ)").toEqual([])
  }, 60_000)
})

describe("a local list is held to the link rule", () => {
  it("a playlist, an ffconcat script, a DASH manifest naming a link; a list forced with -f; a media file is no list", () => {
    const hls = file("l.m3u8", `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${LINK}\n#EXT-X-ENDLIST\n`)
    const hlsAsMp4 = file("l.mp4", `﻿  #EXTM3U\n#EXTINF:2,\n${LINK}\n`)
    const ffconcat = file("l.ffconcat", `ffconcat version 1.0\nfile '${LINK}'\n`)
    const mpd = file("m.mpd", `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><BaseURL>${LINK}</BaseURL></Period></MPD>`)
    const plain = file("plain.txt", `file '${LINK}'\n`)
    const clean = file("clean.ffconcat", "ffconcat version 1.0\nfile 'frame_0001.png'\nduration 0.04\n")
    // A media file that happens to carry a URL in its metadata is no list.
    const media = file("media.mp4", Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.from("http://ns.adobe.com/xap/1.0/")]))
    for (const list of [hls, hlsAsMp4, ffconcat, mpd]) expect(localListProblem(list), list).toBe("names a link")
    expect(localListProblem(`file:${hls}`)).toBe("names a link")
    expect(localListProblem(plain)).toBeUndefined() // not recognised by its bytes …
    expect(localListProblem(plain, "concat")).toBe("names a link") // … but forced as a concat list
    expect(localListProblem(clean, "concat")).toBeUndefined()
    expect(localListProblem(media)).toBeUndefined()
    expect(localListProblem(join(dir, "missing.mp4"))).toBeUndefined()
    expect(localListProblem(join(dir, "missing.txt"), "concat")).toBe("unreadable")
    expect(localListProblem("pipe:0", "concat")).toBeUndefined()
  })
})

describe("the files a filter graph's filters read", () => {
  it("parses a graph as ffmpeg does: labels, chains, quoting and the two escaping levels", () => {
    expect(avGetToken("  a\\:b'c:d' e  ", 0, ":")).toEqual({ token: "a:bc:d e", end: 15 })
    expect(filtersOf("sws_flags=bicubic;[0:v]movie@m1=filename='a\\,b.mp4':f=mp4[m];[in][m]overlay=10:20[out],lut3d=file=x.cube")).toEqual([
      { name: "movie", options: [{ key: "filename", value: "a,b.mp4" }, { key: "f", value: "mp4" }] },
      { name: "overlay", options: [{ value: "10" }, { value: "20" }] },
      { name: "lut3d", options: [{ key: "file", value: "x.cube" }] },
    ])
  })

  it("a movie, amovie or subtitles source that is a list naming a link, or read through another protocol, is refused; a media source passes", () => {
    const hls = file("src.m3u8", `#EXTM3U\n#EXTINF:2,\n${LINK}\n#EXT-X-ENDLIST\n`)
    const plain = file("src.txt", `file '${LINK}'\n`)
    const media = file("overlay.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(graphFileProblem(`movie=${hls}[m];[in][m]overlay`)).toEqual({ filter: "movie", problem: "names a link" })
    expect(graphFileProblem(`amovie=filename=${hls}`)).toEqual({ filter: "amovie", problem: "names a link" })
    expect(graphFileProblem(`movie=${plain}:f=concat`)).toEqual({ filter: "movie", problem: "names a link" })
    expect(graphFileProblem(`subtitles=${hls}`)).toEqual({ filter: "subtitles", problem: "names a link" })
    // `\\\:` at the graph level is `\:` at the filter level, a colon in the value: ffmpeg opens cache:<list>.
    expect(graphFileProblem(`movie=cache\\\\\\:${hls}`)).toEqual({ filter: "movie", problem: "protocol" })
    expect(graphFileProblem(`movie=${media}[m];[in][m]overlay`)).toBeUndefined()
    expect(graphFileProblem("color=c=black:s=64x48,format=gray")).toBeUndefined()
  })

  it("movie's format_opts may not set the guard's own options", () => {
    expect(graphFileProblem("movie=a.m3u8:format_opts='protocol_whitelist=file\\\\\\,http\\\\\\,tcp'")).toEqual({ filter: "movie", problem: "guard option" })
    expect(graphFileProblem("amovie=a.m3u8:format_opts=enable_drefs=1")).toEqual({ filter: "amovie", problem: "guard option" })
    expect(graphFileProblem("movie=a.mp4:format_opts=probesize=5000000")).toBeUndefined()
  })

  it("a text file a filter reads (sendcmd, lut1d, lut3d, drawtext's textfile…) that names a link is refused; a clean one, and a font, pass", () => {
    const cmds = file("cmds.txt", `0.5 drawtext reinit text='${LINK}';\n`)
    const lut = file("lut.cube", `LUT_3D_SIZE 2\n# from ${LINK}\n0 0 0\n`)
    const cleanLut = file("clean.cube", "LUT_1D_SIZE 2\n0.0 0.0 0.0\n1.0 1.0 1.0\n")
    const text = file("text.txt", `visit ${LINK}`)
    const font = file("font.ttf", Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from("http://scripts.example/OFL")]))
    expect(graphFileProblem(`sendcmd=f=${cmds},drawtext=text=x`)).toEqual({ filter: "sendcmd", problem: "names a link" })
    expect(graphFileProblem(`asendcmd=filename=${cmds}`)).toEqual({ filter: "asendcmd", problem: "names a link" })
    expect(graphFileProblem(`lut3d=${lut}`)).toEqual({ filter: "lut3d", problem: "names a link" })
    expect(graphFileProblem(`drawtext=fontfile=${font}:textfile=${text}`)).toEqual({ filter: "drawtext", problem: "names a link" })
    expect(graphFileProblem(`scale=in_range=auto:out_range=full,format=rgb24,lut1d=file=${cleanLut}:interp=nearest`)).toBeUndefined()
    expect(graphFileProblem(`drawtext=fontfile=${font}:text=hello`)).toBeUndefined()
    expect(graphFileProblem(`drawtext=${font}:text=hello`)).toBeUndefined()
    // A text file that names nothing on disk is no file: ffmpeg fails on it itself.
    expect(graphFileProblem(`lut3d=file=${join(dir, "missing.cube")}`)).toBeUndefined()
  })
})

describe("preparePluginRun: a plugin run's arguments", () => {
  it("each option file is read once and handed over as a private copy, removed after", async () => {
    const graph = file("graph.txt", "movie=/tmp/local.mp4[m];[0:v][m]overlay")
    const run = await preparePluginRun(["-y", "-i", "/tmp/in.mp4", "-/filter_complex", graph, "/tmp/o.mp4"], "ffmpeg", { readsLink: false })
    const copy = run.argv[4]!
    expect(copy).not.toBe(graph)
    expect(readFileSync(copy, "utf8")).toBe("movie=/tmp/local.mp4[m];[0:v][m]overlay")
    writeFileSync(graph, `movie=${LINK.replace(/:/g, "\\\\:")}`) // the plugin's file changes after the check
    expect(readFileSync(copy, "utf8")).toBe("movie=/tmp/local.mp4[m];[0:v][m]overlay")
    await run.cleanup()
    expect(existsSync(copy)).toBe(false)
    expect((await preparePluginRun(["-y", "-i", "/tmp/in.mp4", "/tmp/o.mp4"], "ffmpeg", { readsLink: false })).argv).toEqual(["-y", "-i", "/tmp/in.mp4", "/tmp/o.mp4"])
  })

  it("refuses, before anything runs: a widened whitelist, a protocol input or output, a list naming a link, a filter's file naming one, a graph file naming one", async () => {
    const hls = file("run.m3u8", `#EXTM3U\n#EXTINF:2,\n${LINK}\n#EXT-X-ENDLIST\n`)
    const cmds = file("run-cmds.txt", `0 drawtext reinit text='${LINK}';\n`)
    const graphFile = file("run-graph.txt", `sendcmd=f=${cmds}`)
    const lavfiGraph = file("lavfi-graph.txt", `movie=${hls}`)
    const wl = file("wl.txt", "file,http,tcp")
    for (const [args, tool] of [
      [["-protocol_whitelist", "file,http,tcp", "-f", "concat", "-safe", "0", "-i", "/tmp/list.txt", "/tmp/o.mp4"], "ffmpeg"],
      [["-i", "cache:/tmp/l.m3u8", "/tmp/o.mp4"], "ffmpeg"],
      [["-i", "async:/tmp/l.m3u8", "/tmp/o.mp4"], "ffmpeg"],
      [["-i", "/tmp/in.mp4", "-f", "mpegts", "unix:/run/x.sock"], "ffmpeg"],
      [["-i", hls, "/tmp/o.mp4"], "ffmpeg"],
      [["-i", "/tmp/in.mp4", "-vf", `subtitles=${hls}`, "/tmp/o.mp4"], "ffmpeg"],
      [["-f", "lavfi", "-i", `movie=${hls}`, "/tmp/o.mp4"], "ffmpeg"],
      [["-f", "lavfi", "-graph_file", lavfiGraph, "-i", "dummy", "/tmp/o.mp4"], "ffmpeg"],
      [["-i", "/tmp/in.mp4", "-/filter_complex", graphFile, "/tmp/o.mp4"], "ffmpeg"],
      [["-i", "/tmp/in.mp4", "-/af", file("af-link.txt", `amovie=${LINK.replace(/:/g, "\\\\:")}`), "/tmp/o.mp4"], "ffmpeg"],
      [["-i", "/tmp/in.mp4", "-/filter_complex", join(dir, "missing-graph.txt"), "/tmp/o.mp4"], "ffmpeg"],
      [["-v", "error", "-protocol_whitelist", "file,http,tcp", hls], "ffprobe"],
      [["-v", "error", "-/protocol_whitelist", wl, "/tmp/in.mp4"], "ffprobe"],
      [["-v", "error", "cache:/tmp/l.m3u8"], "ffprobe"],
      [["-v", "error", hls], "ffprobe"],
      [["-v", "error", "-f", "lavfi", `movie=${hls}`], "ffprobe"],
      [["-v", "error", "-/i", file("in-name.txt", hls)], "ffprobe"],
    ] as const) {
      const err = await refusal(preparePluginRun(args, tool, { readsLink: false }))
      expect(err, JSON.stringify(args)).toMatchObject({ reason: "link" })
    }
  })

  it("passes what plugins run today: a local whitelist, a pipe, lavfi sources, a local frame list, a lut1d of the host's own", async () => {
    const frames = file("retime.ffconcat", "ffconcat version 1.0\nfile 'f_0001.png'\noption framerate 24\n")
    const lut = file("map.cube", "LUT_1D_SIZE 2\n0.0 0.0 0.0\n1.0 1.0 1.0\n")
    for (const [args, tool] of [
      [["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-ss", "1", "-i", "/tmp/in.mp4", "-t", "2", "/tmp/o.mp4"], "ffmpeg"],
      [["-y", "-safe", "0", "-f", "concat", "-i", frames, "/tmp/o.mp4"], "ffmpeg"],
      [["-f", "lavfi", "-i", "color=c=black:s=64x48:r=24", "-i", "/tmp/in.wav", "-shortest", "/tmp/o.mp4"], "ffmpeg"],
      [["-i", "/tmp/in.mp4", "-vf", `scale=in_range=auto:out_range=full,format=rgb24,lut1d=file=${lut}:interp=nearest`, "/tmp/o.mp4"], "ffmpeg"],
      [["-i", "pipe:0", "-f", "null", "-"], "ffmpeg"],
      [["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type,width:format=duration", "-select_streams", "v:0", "-of", "json", "/tmp/in.mp4"], "ffprobe"],
    ] as const) {
      const run = await preparePluginRun(args, tool, { readsLink: false })
      expect(run.argv, JSON.stringify(args)).toEqual(args)
      await run.cleanup()
    }
  })

  it("a toolkit member's local path is held to the same rule", () => {
    const hls = file("member.m3u8", `#EXTM3U\n#EXTINF:2,\n${LINK}\n`)
    expect(pluginLocalInputRefusal("cache:/tmp/a.m3u8", "ffprobe")).toMatchObject({ reason: "link" })
    expect(pluginLocalInputRefusal(hls, "ffprobe")).toMatchObject({ reason: "link" })
    expect(pluginLocalInputRefusal("/tmp/in.mp4", "ffprobe")).toBeUndefined()
    // A link is the plain probe's to refuse (it reads no link outside the guard).
    expect(pluginLocalInputRefusal(LINK, "ffprobe")).toBeUndefined()
  })
})
