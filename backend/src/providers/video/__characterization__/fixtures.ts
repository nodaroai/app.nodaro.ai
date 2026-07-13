import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runFfmpeg } from "../ffmpeg-utils.js"

/**
 * Synthetic, deterministic input fixtures for the characterization harness.
 *
 * Everything is generated with ffmpeg's lavfi sources: no network, no
 * providers, no credits, no committed media binaries. DETERMINISM IS THE
 * WHOLE POINT — any randomness in an input makes the golden values
 * meaningless, so the only noise source used is `anoisesrc` with an explicit
 * `seed`.
 *
 * Fixtures are content-addressed by FIXTURE_SPEC_VERSION: bump it whenever a
 * fixture definition changes, and a fresh directory is generated. Reusing the
 * cached directory across runs is safe because the generators are
 * deterministic for a given ffmpeg binary.
 */
export const FIXTURE_SPEC_VERSION = 1

export interface FixtureSet {
  readonly dir: string
  /** 300 Hz sine, 1 s, then 4 s silence — 5 s total, 48 kHz mono s16. A clean
   *  probe for level + effect tails (reverb/echo decay into the padding). */
  readonly toneWav: string
  /** SEEDED pink noise, 5 s, 48 kHz mono s16 — broadband probe for EQ/band
   *  changes. */
  readonly noiseWav: string
  /** Unit impulse then silence, 4 s, 48 kHz mono f32 — measures a filter's
   *  impulse response directly. */
  readonly impulseWav: string
  /** 440 Hz sine, 5 s, 44.1 kHz STEREO s16 — exercises resample/downmix
   *  paths (deliberately NOT the 48 kHz mono shape of the others). */
  readonly toneStereo44kWav: string
  /** testsrc2 640x360@30, 3 s, with a 440 Hz tone — h264+aac. */
  readonly clipMp4: string
  /** testsrc2 640x360@30, 3 s, NO audio stream — h264. */
  readonly clipSilentMp4: string
  /** smptebars 480x270@30, 2 s, with an 880 Hz tone — a second, visually and
   *  audibly distinct clip for combine/concat operations. */
  readonly clip2Mp4: string
  /** testsrc2 320x568@30 (portrait), 2 s, silent — resolution-mismatch input
   *  for combine/resize paths. */
  readonly clipPortraitMp4: string
  /** 300 Hz sine, 1.2 s, 48 kHz mono s16 — a voice SHORTER than the 3 s clip,
   *  for assemble-narrated-video's `pad` plan. */
  readonly toneShortWav: string
  /** One testsrc2 640x360 frame as PNG — image input for social-media-format. */
  readonly framePng: string
  /** testsrc2 [0, 1.3) s @30, silent — the PREV clip of a continuation pair:
   *  its last frames overlap clipTailMp4's first frames (same testsrc2
   *  timeline), so smart-cut boundary matching has a real twin to find. */
  readonly clipHeadMp4: string
  /** testsrc2 [1.0, 3.0) s @30, silent — the NEXT clip of the continuation
   *  pair (starts 0.3 s before clipHeadMp4 ends). */
  readonly clipTailMp4: string
}

/** One ffmpeg invocation per fixture, ordered to match FixtureSet fields. */
const GENERATORS: ReadonlyArray<{ file: string; args: (out: string) => string[] }> = [
  {
    file: "tone.wav",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "sine=f=300:d=1:r=48000",
      "-af", "apad=pad_dur=4", "-t", "5", "-c:a", "pcm_s16le", out,
    ],
  },
  {
    file: "noise.wav",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "anoisesrc=r=48000:d=5:c=pink:a=0.5:seed=1234",
      "-c:a", "pcm_s16le", out,
    ],
  },
  {
    file: "impulse.wav",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "aevalsrc='if(eq(n,0),1,0)':s=48000:d=4",
      "-c:a", "pcm_f32le", out,
    ],
  },
  {
    file: "tone-stereo-44k.wav",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "sine=f=440:d=5:r=44100",
      "-af", "aformat=channel_layouts=stereo", "-c:a", "pcm_s16le", out,
    ],
  },
  {
    file: "clip.mp4",
    args: (out) => [
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
      "-f", "lavfi", "-i", "sine=f=440:d=3:r=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
    ],
  },
  {
    file: "clip-silent.mp4",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", out,
    ],
  },
  {
    file: "clip2.mp4",
    args: (out) => [
      "-y",
      "-f", "lavfi", "-i", "smptebars=size=480x270:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=f=880:d=2:r=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
    ],
  },
  {
    file: "clip-portrait.mp4",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "testsrc2=size=320x568:rate=30:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", out,
    ],
  },
  {
    file: "tone-short.wav",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "sine=f=300:d=1.2:r=48000", "-c:a", "pcm_s16le", out,
    ],
  },
  {
    file: "frame.png",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=1",
      "-frames:v", "1", out,
    ],
  },
  {
    file: "clip-head.mp4",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=1.3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", out,
    ],
  },
  {
    file: "clip-tail.mp4",
    args: (out) => [
      "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
      "-ss", "1.0",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", out,
    ],
  },
]

/**
 * Generate (or reuse) the fixture set. Reuse is keyed on the spec version and
 * the presence of every file — a partially generated directory is rebuilt.
 */
export async function ensureFixtures(): Promise<FixtureSet> {
  const dir = join(tmpdir(), `nodaro-characterize-fixtures-v${FIXTURE_SPEC_VERSION}`)
  await fs.mkdir(dir, { recursive: true })

  for (const gen of GENERATORS) {
    const outPath = join(dir, gen.file)
    const exists = await fs.stat(outPath).then((s) => s.size > 0, () => false)
    if (!exists) await runFfmpeg(gen.args(outPath))
  }

  return {
    dir,
    toneWav: join(dir, "tone.wav"),
    noiseWav: join(dir, "noise.wav"),
    impulseWav: join(dir, "impulse.wav"),
    toneStereo44kWav: join(dir, "tone-stereo-44k.wav"),
    clipMp4: join(dir, "clip.mp4"),
    clipSilentMp4: join(dir, "clip-silent.mp4"),
    clip2Mp4: join(dir, "clip2.mp4"),
    clipPortraitMp4: join(dir, "clip-portrait.mp4"),
    toneShortWav: join(dir, "tone-short.wav"),
    framePng: join(dir, "frame.png"),
    clipHeadMp4: join(dir, "clip-head.mp4"),
    clipTailMp4: join(dir, "clip-tail.mp4"),
  }
}

/**
 * Fixture URLs — what the harness feeds to the production modules' `*Url`
 * options. The modules never fetch them: the characterization suite
 * partial-mocks `downloadFile` (ONLY that export; everything else in
 * ffmpeg-utils stays real) to copy the matching fixture file to the module's
 * chosen destination path. `.invalid` is an IANA-reserved TLD, so if the mock
 * ever silently stops intercepting (e.g. a module grows its own fetch path),
 * the download fails loudly instead of hitting the network.
 */
export const FIXTURE_URL_BASE = "https://characterization.invalid/"

export function fixtureUrl(fixturePath: string): string {
  const file = fixturePath.split("/").pop() ?? fixturePath
  return `${FIXTURE_URL_BASE}${file}`
}

/** Resolve a fixture URL back to its local file. Throws on anything that is
 *  not a known fixture — an unexpected URL means an operation tried to fetch
 *  something the harness never provisioned. */
export function fixtureLocalPath(url: string): string {
  if (!url.startsWith(FIXTURE_URL_BASE)) {
    throw new Error(`characterization downloadFile mock got a non-fixture URL: ${url}`)
  }
  const file = url.slice(FIXTURE_URL_BASE.length).split("?")[0]
  if (!GENERATORS.some((g) => g.file === file)) {
    throw new Error(`characterization downloadFile mock got an unknown fixture: ${file}`)
  }
  return join(tmpdir(), `nodaro-characterize-fixtures-v${FIXTURE_SPEC_VERSION}`, file)
}
