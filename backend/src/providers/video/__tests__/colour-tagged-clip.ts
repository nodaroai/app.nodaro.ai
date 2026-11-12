// @test-reads-none writes one clip with ffmpeg; reads no file
/**
 * Colour-tagged test clips that carry their tags on any ffmpeg, for the
 * real-ffmpeg tests (`extend-stitch-output.test.ts`, `extract-tail.test.ts`).
 * Not a test file (vitest collects only `*.test.ts`).
 *
 * The encoder options alone are not enough. ffmpeg 8.x's encoder takes its
 * primaries and transfer from the frames (`fftools/ffmpeg_enc.c` `enc_open`),
 * not from `-color_primaries` / `-color_trc`, so a lavfi clip (untagged
 * frames) comes out without them there (the pinned n8.1.2 did), while 9.x
 * applies them. So every tag goes on three ways, each enough on its own: on
 * the frames (`setparams`), as the encoder's options, and straight into x264's
 * own VUI (`-x264-params`).
 */
import { runFfmpeg } from "../ffmpeg-utils.js"

/** A clip's colour description, in ffmpeg's (and x264's) names. */
export interface ColourTags {
  primaries: string
  transfer: string
  matrix: string
  range: "tv" | "pc"
}

/** An HDR clip's tags: BT.2020 primaries and matrix, limited range, `transfer` (HLG `arib-std-b67`, PQ `smpte2084`). */
export const hdrTags = (transfer: string): ColourTags => ({ primaries: "bt2020", transfer, matrix: "bt2020nc", range: "tv" })

/** `tags` as ffmpeg arguments: the frames' `setparams` filter, and the encoder's options with x264's own. */
export function colourTagArgs(tags: ColourTags): { filter: string; encoder: string[] } {
  return {
    filter: `setparams=color_primaries=${tags.primaries}:color_trc=${tags.transfer}:colorspace=${tags.matrix}:range=${tags.range}`,
    encoder: [
      "-color_primaries", tags.primaries, "-color_trc", tags.transfer, "-colorspace", tags.matrix, "-color_range", tags.range,
      "-x264-params", `colorprim=${tags.primaries}:transfer=${tags.transfer}:colormatrix=${tags.matrix}:range=${tags.range}`,
    ],
  }
}

/**
 * An H.264 4:2:0 MP4 of testsrc2 at `size` ("WxH", 24 fps) for `seconds`, with
 * a 440 Hz sine (AAC), tagged `tags`. 8-bit: what an HDR reader goes by is the
 * tags, not the bit depth.
 */
export async function writeTaggedClip(out: string, tags: ColourTags, opts: { size: string; seconds: number; bitRate?: string }): Promise<void> {
  const { filter, encoder } = colourTagArgs(tags)
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `testsrc2=size=${opts.size}:rate=24:duration=${opts.seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${opts.seconds}:sample_rate=48000`,
    "-vf", filter,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(opts.bitRate ? ["-b:v", opts.bitRate] : []), ...encoder,
    "-c:a", "aac", "-shortest",
    out,
  ])
}
