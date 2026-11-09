/**
 * `tk.providers.generateMusic` — the gvp keyframes music lane's toolkit
 * member (ADDITIVE 2026-08-04). Wraps `sunoGenerate` from
 * `providers/kie/suno-client.ts` reduced to ONE track. TWO MODES: without a
 * title it is DESCRIPTION mode (a brief; the model invents the song; the
 * duration hint is custom-mode-gated upstream so it is never sent), and with
 * a title AND style it is CUSTOM mode (2026-08-19) — `prompt` becomes the
 * exact LYRICS, `style` the musical description, and `duration` is honoured
 * on the V6 family. Instrumental defaults ON either way; the first track wins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockSunoGenerate } = vi.hoisted(() => ({ mockSunoGenerate: vi.fn() }))
vi.mock("../../../providers/kie/suno-client.js", () => ({
  sunoGenerate: mockSunoGenerate,
  // Real (pure) impl — the toolkit uses it to derive the egress modelKey.
  sunoCreditType: (model: string | undefined, fallback: string) =>
    ({ V6: "suno-v6", V5_5: "suno-v5_5", V5: "suno-v5" } as Record<string, string>)[model ?? ""] ?? fallback,
}))

import { buildToolkit } from "../toolkit.js"
import { clearPromptPolicies, registerPromptPolicy } from "../../prompt-policy.js"

describe("tk.providers.generateMusic", () => {
  beforeEach(() => {
    mockSunoGenerate.mockReset()
  })

  const track = (over: Record<string, unknown> = {}) => ({
    id: "t1", audioUrl: "https://suno/track-1.mp3", duration: 187.4, ...over,
  })

  it("without a title: description mode + V6, instrumental ON, style forwarded, and NO duration hint", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "suno-task-1", tracks: [track()] })
    const tk = buildToolkit()
    const res = await tk.providers.generateMusic!("tense cinematic chase score", {
      style: "orchestral hybrid, 140 BPM",
      durationSec: 76, // advisory — must not reach the wire
    })
    expect(mockSunoGenerate).toHaveBeenCalledTimes(1)
    const [params, reconcile] = mockSunoGenerate.mock.calls[0]!
    expect(params).toEqual({
      prompt: "tense cinematic chase score",
      model: "V6",
      customMode: false,
      instrumental: true,
      style: "orchestral hybrid, 140 BPM",
    })
    expect(params.duration).toBeUndefined()
    // B3 egress: even with no onTaskCreated, OUR modelKey rides the reconcileOpts
    // (model is pinned V6 → "suno-v6") so the seam attributes this billed create.
    expect(reconcile).toEqual({ modelKey: "suno-v6" })
    expect(res).toEqual({ url: "https://suno/track-1.mp3", durationSec: 187.4, taskId: "suno-task-1" })
  })

  /**
   * CUSTOM MODE (2026-08-19). Description mode with vocals makes Suno invent
   * lyrics ABOUT the brief — a scat ensemble briefed with "singers swaying
   * and tapping feet" sang "step-step sway on through … feet go tap". The
   * source's own syllables can only be reproduced as LYRICS, which is what
   * custom mode is for; it also unlocks the provider's duration.
   */
  it("a title + style selects CUSTOM mode: prompt is the lyrics, style carries the description, duration is sent", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "suno-custom", tracks: [track()] })
    const tk = buildToolkit()
    await tk.providers.generateMusic!("[Intro]\nPa ra pa pa pri pa\n\n[Verse]\nto pe pe pari pore", {
      style: "acoustic world-jazz, ~100 bpm feel, upright bass and hand percussion",
      title: "Studio Session — Opening Scat",
      instrumental: false,
      durationSec: 26.4,
    })
    expect(mockSunoGenerate.mock.calls[0]![0]).toEqual({
      prompt: "[Intro]\nPa ra pa pa pri pa\n\n[Verse]\nto pe pe pari pore",
      model: "V6",
      customMode: true,
      instrumental: false,
      style: "acoustic world-jazz, ~100 bpm feel, upright bass and hand percussion",
      title: "Studio Session — Opening Scat",
      duration: 26, // rounded, inside the documented 10–360 window
    })
  })

  it("custom mode trims to the provider's ceilings rather than failing the render (style 1000, title 80, lyrics 5000)", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [track()] })
    const tk = buildToolkit()
    await tk.providers.generateMusic!("L".repeat(5200), {
      style: "s".repeat(1200),
      title: "T".repeat(140),
      instrumental: false,
    })
    const sent = mockSunoGenerate.mock.calls[0]![0]
    expect(sent.prompt).toHaveLength(5000)
    expect(sent.style).toHaveLength(1000)
    expect(sent.title).toHaveLength(80)
  })

  it("duration is clamped into the provider's 10–360s window", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [track()] })
    const tk = buildToolkit()
    const opts = { style: "s", title: "t", instrumental: false }
    await tk.providers.generateMusic!("lyrics", { ...opts, durationSec: 4 })
    expect(mockSunoGenerate.mock.calls[0]![0].duration).toBe(10)
    await tk.providers.generateMusic!("lyrics", { ...opts, durationSec: 999 })
    expect(mockSunoGenerate.mock.calls[1]![0].duration).toBe(360)
  })

  it("a title WITHOUT a style stays in description mode — custom mode requires both, and a refused request is worse than a plainer one", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [track()] })
    const tk = buildToolkit()
    await tk.providers.generateMusic!("a brief", { title: "Some Title", durationSec: 30 })
    const sent = mockSunoGenerate.mock.calls[0]![0]
    expect(sent.customMode).toBe(false)
    expect(sent.title).toBeUndefined()
    expect(sent.duration).toBeUndefined()
  })

  it("instrumental: false is honored, and the FIRST track wins when Suno returns two takes", async () => {
    mockSunoGenerate.mockResolvedValue({
      taskId: "suno-task-2",
      tracks: [track({ audioUrl: "https://suno/take-a.mp3" }), track({ audioUrl: "https://suno/take-b.mp3" })],
    })
    const tk = buildToolkit()
    const res = await tk.providers.generateMusic!("ballad with vocals", { instrumental: false })
    expect(mockSunoGenerate.mock.calls[0]![0]).toMatchObject({ instrumental: false })
    expect(res.url).toBe("https://suno/take-a.mp3")
  })

  it("a non-finite reported duration is dropped rather than forwarded", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [track({ duration: Number.NaN })] })
    const tk = buildToolkit()
    const res = await tk.providers.generateMusic!("brief")
    expect(res.durationSec).toBeUndefined()
  })

  it("throws on an empty result so the caller's non-fatal music guard can degrade", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [] })
    const tk = buildToolkit()
    await expect(tk.providers.generateMusic!("brief")).rejects.toThrow(/no track/)
  })

  /**
   * The deployment's prompt policy reaches plugin music through these two
   * fields: the plugin runs `tk.prompts.applyPolicies` over its music prompt
   * once, at its own boundary, and hands the vocal gender and negative style it
   * returned to this member, which forwards them the way the platform's own
   * Suno worker forwards a policed assembly (`negativeStyle || undefined`, the
   * vocal gender as given). An older plugin sends neither: nothing changes.
   */
  it("forwards a vocal gender and a negative style, in description mode", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [track()] })
    const tk = buildToolkit()
    await tk.providers.generateMusic!("an upbeat pop song about summer", {
      instrumental: false,
      vocalGender: "female",
      negativeStyle: "heavy metal, screaming",
    })
    expect(mockSunoGenerate.mock.calls[0]![0]).toEqual({
      prompt: "an upbeat pop song about summer",
      model: "V6",
      customMode: false,
      instrumental: false,
      vocalGender: "female",
      negativeStyle: "heavy metal, screaming",
    })
  })

  it("forwards them in custom mode too, beside the lyrics, style and title", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [track()] })
    const tk = buildToolkit()
    await tk.providers.generateMusic!("[Verse]\nla la la", {
      style: "acoustic folk",
      title: "Song",
      instrumental: false,
      vocalGender: "male",
      negativeStyle: "autotune",
    })
    expect(mockSunoGenerate.mock.calls[0]![0]).toEqual({
      prompt: "[Verse]\nla la la",
      model: "V6",
      customMode: true,
      instrumental: false,
      style: "acoustic folk",
      title: "Song",
      vocalGender: "male",
      negativeStyle: "autotune",
    })
  })

  it("sends neither when they are empty (an empty negative is none, as the Suno worker reads it)", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [track()] })
    const tk = buildToolkit()
    await tk.providers.generateMusic!("brief", { vocalGender: "", negativeStyle: "" })
    const sent = mockSunoGenerate.mock.calls[0]![0]
    expect(sent).not.toHaveProperty("vocalGender")
    expect(sent).not.toHaveProperty("negativeStyle")
  })

  describe("the prompt policy is applied once, by the plugin, never again by the host", () => {
    afterEach(() => clearPromptPolicies())

    const forcing = () =>
      registerPromptPolicy({
        id: "test-forced-vocals",
        apply: (a) =>
          a.kind !== "audio"
            ? a
            : {
                ...a,
                prompt: a.prompt.includes("[policed]") ? a.prompt : `${a.prompt} [policed]`,
                negativePrompt: a.negativePrompt.includes("explicit") ? a.negativePrompt : [a.negativePrompt, "explicit"].filter(Boolean).join(", "),
                vocalGender: "female",
              },
      })

    it("the host member runs no policy of its own: what it is handed is what the provider gets", async () => {
      forcing()
      mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [track()] })
      const tk = buildToolkit()

      await tk.providers.generateMusic!("brief", { instrumental: false })
      const bare = mockSunoGenerate.mock.calls[0]![0]
      expect(bare.prompt).toBe("brief")
      expect(bare).not.toHaveProperty("vocalGender")
      expect(bare).not.toHaveProperty("negativeStyle")

      await tk.providers.generateMusic!("brief", { instrumental: false, vocalGender: "male", negativeStyle: "drums" })
      expect(mockSunoGenerate.mock.calls[1]![0]).toMatchObject({ prompt: "brief", vocalGender: "male", negativeStyle: "drums" })
    })

    it("a plugin that polices with tk.prompts and sends what it returned reaches the provider policed exactly once", async () => {
      forcing()
      mockSunoGenerate.mockResolvedValue({ taskId: "t", tracks: [track()] })
      const tk = buildToolkit()
      // The plugin's side of the boundary: police the music prompt once, then
      // hand the provider member what the policy returned.
      const policed = tk.prompts!.applyPolicies({ prompt: "brief", negativePrompt: "drums", kind: "audio" })
      await tk.providers.generateMusic!(policed.prompt, {
        instrumental: false,
        ...(policed.vocalGender ? { vocalGender: policed.vocalGender } : {}),
        negativeStyle: policed.negativePrompt,
      })

      expect(mockSunoGenerate.mock.calls[0]![0]).toMatchObject({
        prompt: "brief [policed]",
        vocalGender: "female",
        negativeStyle: "drums, explicit",
      })
    })
  })

  it("adapts onTaskCreated into ReconcileOpts (void-returning callbacks awaited as promises)", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "suno-task-3", tracks: [track()] })
    const seen: string[] = []
    const tk = buildToolkit()
    await tk.providers.generateMusic!("brief", { onTaskCreated: (id) => void seen.push(id) })
    const [, reconcile] = mockSunoGenerate.mock.calls[0]!
    expect(typeof reconcile?.onTaskCreated).toBe("function")
    // The onTaskCreated adapter and OUR modelKey coexist on the reconcileOpts.
    expect(reconcile.modelKey).toBe("suno-v6")
    await reconcile.onTaskCreated("task-xyz")
    expect(seen).toEqual(["task-xyz"])
  })
})
