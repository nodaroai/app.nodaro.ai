import { promises as fs } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Metrics } from "./measure.js"

/**
 * Golden-file I/O shared by the characterization suite and the report tool.
 *
 * A golden file records, per operation, the measured metrics of every output
 * it renders — blessed against ONE exact ffmpeg binary, whose version string
 * is embedded and enforced (a check run against any other binary fails fast
 * rather than comparing apples to oranges; see Traps 1 and 3 in the plan:
 * local Homebrew ffmpeg and the bare GitHub runner's ffmpeg are both the
 * wrong binary).
 */

export interface GoldenOutput {
  readonly label: string
  readonly metrics: Metrics
}

export interface GoldenFile {
  /** Exact `ffmpeg -version` token of the binary that blessed these numbers,
   *  e.g. "5.1.9-0+deb12u1". */
  readonly ffmpegVersion: string
  readonly operations: Readonly<Record<string, readonly GoldenOutput[]>>
}

export const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "golden")

/** The committed reference golden. UPDATE THIS (and re-bless) in the same PR
 *  that bumps the Dockerfile's FFMPEG_VERSION pin — the version guard in
 *  characterize.char.ts fails the suite until the two agree. */
export const DEFAULT_GOLDEN_FILE = "ffmpeg-5.1.9.json"

/** "5.1.9-0+deb12u1" → "ffmpeg-5.1.9.json" (bare upstream version; the Debian
 *  revision lives inside the file). */
export function goldenFileNameForVersion(version: string): string {
  return `ffmpeg-${version.split("-")[0]}.json`
}

export async function loadGolden(file: string = DEFAULT_GOLDEN_FILE): Promise<GoldenFile> {
  const path = join(GOLDEN_DIR, file)
  let raw: string
  try {
    raw = await fs.readFile(path, "utf8")
  } catch {
    throw new Error(
      `golden file not found: ${path}\n` +
        `Bless it first — inside the production image — via backend/scripts/characterize-in-image.sh bless`,
    )
  }
  return JSON.parse(raw) as GoldenFile
}

export async function saveGolden(golden: GoldenFile, file: string): Promise<string> {
  const path = join(GOLDEN_DIR, file)
  const sorted: GoldenFile = {
    ffmpegVersion: golden.ffmpegVersion,
    operations: Object.fromEntries(
      Object.keys(golden.operations)
        .sort()
        .map((k) => [k, golden.operations[k]]),
    ),
  }
  await fs.mkdir(GOLDEN_DIR, { recursive: true })
  await fs.writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf8")
  return path
}
