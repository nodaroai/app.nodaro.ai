import { describe, expect, expectTypeOf, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { buildToolkit } from "../toolkit.js"
import { FFMPEG_MEMBER_LANES } from "../toolkit-lanes.js"
import type { PluginMp3Cut, PluginMp3EncodeOptions } from "../types.js"
import { isFramedMp3Encode, mp3EncodeArgs, mp3GraphEncodeArgs, type Mp3Cut, type Mp3EncodeOptions } from "../../../providers/video/mp3-encode.js"

type AllKeys<T> = T extends unknown ? keyof T : never

/**
 * A plugin encodes MP3 through `tk.ffmpeg.runFfmpeg` with argv it builds; the
 * host's own MP3 helper is lent to it so that argv ends the way every host
 * MP3 encode does (mp3-encode.ts). Additive-optional: an older host lacks it,
 * and a plugin feature-detects it with `typeof`.
 */
describe("tk.ffmpeg.mp3EncodeArgs / mp3GraphEncodeArgs", () => {
  it("are the host's own builders, synchronous and outside any concurrency slot", () => {
    const tk = buildToolkit()
    const args = tk.ffmpeg.mp3EncodeArgs?.({ filters: ["volume=0.5"], cut: { start: 1, end: 2.5 }, quality: 2 })
    expect(args).toEqual(mp3EncodeArgs({ filters: ["volume=0.5"], cut: { start: 1, end: 2.5 }, quality: 2 }))
    expect(tk.ffmpeg.mp3GraphEncodeArgs?.("[0:a][1:a]amix=inputs=2[a]", "[a]", { bitrate: "128k" })).toEqual(
      mp3GraphEncodeArgs("[0:a][1:a]amix=inputs=2[a]", "[a]", { bitrate: "128k" }),
    )
    expect(isFramedMp3Encode(["-y", "-i", "/w/in.wav", ...args!, "/w/out.mp3"])).toBe(true)
    expect(FFMPEG_MEMBER_LANES.mp3EncodeArgs).toHaveProperty("exempt")
    expect(FFMPEG_MEMBER_LANES.mp3GraphEncodeArgs).toHaveProperty("exempt")
  })

  it("the contract's option types mirror the helper's", () => {
    expectTypeOf<AllKeys<PluginMp3EncodeOptions>>().toEqualTypeOf<AllKeys<Mp3EncodeOptions>>()
    expectTypeOf<AllKeys<PluginMp3Cut>>().toEqualTypeOf<AllKeys<Mp3Cut>>()
    const opts: PluginMp3EncodeOptions = { filters: ["anull"], cut: { duration: 3 }, sampleRate: 44100, bitrate: "192k" }
    const real: Mp3EncodeOptions = opts
    expect(real.cut?.duration).toBe(3)
  })
})
