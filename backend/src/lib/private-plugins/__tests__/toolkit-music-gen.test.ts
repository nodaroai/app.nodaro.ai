/**
 * `tk.providers.generateMusic` — the gvp keyframes music lane's toolkit
 * member (ADDITIVE 2026-08-04). Wraps `sunoGenerate` from
 * `providers/kie/suno-client.ts` reduced to ONE track. TWO MODES: without a
 * title it is DESCRIPTION mode (a brief; the model invents the song; the
 * duration hint is custom-mode-gated upstream so it is never sent), and with
 * a title AND style it is CUSTOM mode (2026-08-19) — `prompt` becomes the
 * exact LYRICS, `style` the musical description, and `duration` is honoured
 * on V5_5. Instrumental defaults ON either way; the first track wins.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockSunoGenerate } = vi.hoisted(() => ({ mockSunoGenerate: vi.fn() }))
vi.mock("../../../providers/kie/suno-client.js", () => ({
  sunoGenerate: mockSunoGenerate,
  // Real (pure) impl — the toolkit uses it to derive the egress modelKey.
  sunoCreditType: (model: string | undefined, fallback: string) =>
    model === "V5_5" ? "suno-v5_5" : model === "V5" ? "suno-v5" : fallback,
}))

import { buildToolkit } from "../toolkit.js"

describe("tk.providers.generateMusic", () => {
  beforeEach(() => {
    mockSunoGenerate.mockReset()
  })

  const track = (over: Record<string, unknown> = {}) => ({
    id: "t1", audioUrl: "https://suno/track-1.mp3", duration: 187.4, ...over,
  })

  it("without a title: description mode + V5_5, instrumental ON, style forwarded, and NO duration hint", async () => {
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
      model: "V5_5",
      customMode: false,
      instrumental: true,
      style: "orchestral hybrid, 140 BPM",
    })
    expect(params.duration).toBeUndefined()
    // B3 egress: even with no onTaskCreated, OUR modelKey rides the reconcileOpts
    // (model is pinned V5_5 → "suno-v5_5") so the seam attributes this billed create.
    expect(reconcile).toEqual({ modelKey: "suno-v5_5" })
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
      model: "V5_5",
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

  it("adapts onTaskCreated into ReconcileOpts (void-returning callbacks awaited as promises)", async () => {
    mockSunoGenerate.mockResolvedValue({ taskId: "suno-task-3", tracks: [track()] })
    const seen: string[] = []
    const tk = buildToolkit()
    await tk.providers.generateMusic!("brief", { onTaskCreated: (id) => void seen.push(id) })
    const [, reconcile] = mockSunoGenerate.mock.calls[0]!
    expect(typeof reconcile?.onTaskCreated).toBe("function")
    // The onTaskCreated adapter and OUR modelKey coexist on the reconcileOpts.
    expect(reconcile.modelKey).toBe("suno-v5_5")
    await reconcile.onTaskCreated("task-xyz")
    expect(seen).toEqual(["task-xyz"])
  })
})
