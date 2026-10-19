/**
 * What an audio recording forces on a use-case node is its spec's
 * `audioForced` (packages/render-rules/src/use-case-specs.ts): the node data
 * the editor writes when the recording wired into `media` is audio, declared
 * once. The editor's lock writes these values; the run's resolver is what
 * actually reads an audio recording, so the two are held to each other here.
 *
 * Both ways, as far as is true:
 *  - every forced key is a setting the run sends, and the resolver, given the
 *    opposite of each forced value, reads exactly the forced value for audio;
 *  - for every spec that takes an audio recording (declaring audioForced or
 *    not), every setting the resolver reads differently for audio than for
 *    video is either forced or named below with the reason it is not.
 */
import { describe, expect, it } from "vitest"
import { USE_CASE_NODE_TYPES, USE_CASE_SPECS, usecaseDescriptor, usecaseRowOf, type UseCaseBuilderKey } from "@nodaro/render-rules"

/** A raw node holding the opposite of every value an audio recording could force. */
const OPPOSITE: Readonly<Record<string, unknown>> = {
  output: "video",
  captions: true,
  framing: { aspect: "9:16", layout: "stacked" },
}

/**
 * Settings the resolver reads differently for an audio recording that the
 * lock deliberately leaves alone, per builder, with the reason.
 */
const RESOLVED_NOT_FORCED: Readonly<Partial<Record<UseCaseBuilderKey, Readonly<Record<string, string>>>>> = {
  tighten: {
    // An audio episode has no picture, so the run reads no framing; the lock
    // only hides it, so the person's framing is still there when a video
    // recording is wired again.
    framing: "hidden on an audio episode, never cleared",
  },
}

const specs = Object.entries(USE_CASE_SPECS) as [UseCaseBuilderKey, (typeof USE_CASE_SPECS)[UseCaseBuilderKey]][]
const forcing = specs.filter(([, spec]) => spec.audioForced !== undefined)
/** The specs that take an audio recording: each one's resolver is checked, whether it declares audioForced or not. */
const takingAudio = specs.filter(([, spec]) => !spec.needsVideo)

/** The settings the resolver reads differently for audio than for video, from the opposite raw. */
function resolvedByAudio(key: UseCaseBuilderKey): string[] {
  const spec = USE_CASE_SPECS[key]
  const audio = spec.resolveSettings(OPPOSITE, "audio")
  const video = spec.resolveSettings(OPPOSITE, "video")
  return spec.settingKeys.filter((k) => !Object.is(audio[k], video[k]) && JSON.stringify(audio[k]) !== JSON.stringify(video[k]))
}

describe("audioForced: what an audio recording forces is declared on the spec", () => {
  it("Tighten declares it (the editor's lock reads it)", () => {
    expect(USE_CASE_SPECS.tighten.audioForced).toEqual({ output: "audio", captions: false })
    expect(forcing.map(([k]) => k)).toContain("tighten")
  })

  it("a spec that refuses an audio recording forces nothing on one", () => {
    for (const [key, spec] of specs) {
      if (spec.needsVideo) expect(spec.audioForced, key).toBeUndefined()
    }
    expect(USE_CASE_SPECS.trailer.needsVideo).toBe(true)
  })

  it.each(forcing)("%s: every forced key is a setting the run sends", (_key, spec) => {
    for (const k of Object.keys(spec.audioForced!)) expect(spec.settingKeys).toContain(k)
  })

  it.each(forcing)("%s: the resolver reads each forced value for an audio recording, from the opposite", (_key, spec) => {
    const resolved = spec.resolveSettings(OPPOSITE, "audio")
    for (const [k, v] of Object.entries(spec.audioForced!)) {
      // The resolver writes `false` captions and a `null` framing, never `undefined`: compared as written.
      expect(Object.is(resolved[k], v), `${k}: resolved ${String(resolved[k])}, forced ${String(v)}`).toBe(true)
    }
  })

  it.each(takingAudio)("%s: every setting the resolver reads differently for audio is forced or named with its reason", (key, spec) => {
    const forced = Object.keys(spec.audioForced ?? {})
    const exempt = RESOLVED_NOT_FORCED[key] ?? {}
    const byAudio = resolvedByAudio(key)
    for (const k of forced) expect(byAudio, `${k} is forced but the resolver reads it the same for video`).toContain(k)
    expect(byAudio.filter((k) => !forced.includes(k)).sort()).toEqual(Object.keys(exempt).sort())
  })

  it("the opposite raw is a framing the video side keeps (so the framing exemption is not vacuous)", () => {
    expect(USE_CASE_SPECS.tighten.resolveSettings(OPPOSITE, "video").framing).not.toBeNull()
    expect(USE_CASE_SPECS.tighten.resolveSettings(OPPOSITE, "audio").framing).toBeNull()
  })

  it("every use-case type's descriptor carries its spec's audioForced", () => {
    for (const t of USE_CASE_NODE_TYPES) {
      const d = usecaseDescriptor(t)
      expect(d.audioForced, t).toBe(USE_CASE_SPECS[usecaseRowOf(t).builder as UseCaseBuilderKey].audioForced)
    }
    expect(usecaseDescriptor("tighten-episode").audioForced).toEqual({ output: "audio", captions: false })
  })
})
