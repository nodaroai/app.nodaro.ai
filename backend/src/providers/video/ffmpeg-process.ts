/**
 * The one place the backend starts the ffmpeg binary.
 *
 * ffmpeg's auto-threading counts the host's cores, not the container's CPU
 * quota, and under a quota that multiplied libx264's frame threads — and their
 * memory — past what the box holds (`ffmpeg-threads.ts`). Every ffmpeg is
 * therefore told the box's counts (decided 2026-10-05), and they are placed
 * HERE, so no caller can forget them: `runFfmpeg`, `runFfmpegCapture` and
 * `runFfmpegWithProgress` (ffmpeg-utils), `runFfmpegCancellable`, and the few
 * spawns that stream ffmpeg's output themselves all launch through this file.
 * `ffmpeg-spawn-census.test.ts` fails the build on a launch anywhere else.
 *
 * The box is read on every launch — a few small `/proc` and cgroup reads,
 * nothing next to starting ffmpeg. On a box with no quota below the cores
 * ffmpeg counts, the argv reaches ffmpeg exactly as the caller built it.
 *
 * WHEN a launch may start is decided before it reaches this file: the runners
 * in ffmpeg-utils (and `withFfmpegSlot`) admit each one against the
 * `FFMPEG_CONCURRENCY` slots AND the box's ffmpeg memory budget, reserving its
 * predicted peak until it exits (`ffmpeg-admission.ts`, decided 2026-10-05).
 */
import {
  execFile,
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type ExecFileException,
  type ExecFileOptionsWithStringEncoding,
  type SpawnOptions,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioPipe,
} from "node:child_process"
import type { Readable } from "node:stream"
import { ffmpegThreads, withFfmpegThreads } from "./ffmpeg-threads.js"

/** The argv ffmpeg actually runs: `args` with this box's thread counts placed
 *  in it (`withFfmpegThreads`), or `args` as given when there are none. */
export function ffmpegArgv(args: readonly string[]): string[] {
  return withFfmpegThreads(args, ffmpegThreads())
}

/** `spawn("ffmpeg", …)` with the box's thread counts placed in `args`. */
export function spawnFfmpeg(
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>,
): ChildProcessByStdio<null, Readable, Readable>
export function spawnFfmpeg(
  args: readonly string[],
  options: SpawnOptionsWithStdioTuple<StdioNull, StdioNull, StdioPipe>,
): ChildProcessByStdio<null, null, Readable>
export function spawnFfmpeg(args: readonly string[], options: SpawnOptions): ChildProcess {
  return spawn("ffmpeg", ffmpegArgv(args), options)
}

/** `execFile("ffmpeg", …)` with the box's thread counts placed in `args`. */
export function execFileFfmpeg(
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
): ChildProcess {
  return execFile("ffmpeg", ffmpegArgv(args), options, callback)
}
