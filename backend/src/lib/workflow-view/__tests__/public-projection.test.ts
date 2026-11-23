/**
 * A view link hands out three things — the canvas (`projectWorkflowView`),
 * the preview card (`readViewCard`) and the frozen copy (`buildViewExport`) —
 * and all three come from ONE public projection. Each sensitive field of a
 * fixture workflow is asserted absent from all three outputs; what the canvas
 * is for (results, prompts, notes) is asserted present.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const RESTRICTED = "https://cdn.example/images/restricted.png"
const PRIVATE_RESULT = "https://cdn.example/images/kept-private.png"
const OWNER = "00000000-0000-4000-8000-0000000000aa"
const PRIVATE_JOB = "00000000-0000-4000-8000-0000000000b1"
const PUBLIC_JOB = "00000000-0000-4000-8000-0000000000b2"

const jobs = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}))
vi.mock("../../supabase.js", async () => {
  const { makeFakeFrom } = await import("../../__tests__/fake-supabase-query.js")
  return {
    supabase: {
      from: makeFakeFrom([], (q) => {
        if (q.table !== "jobs") return { data: null, error: null }
        const owner = q.ops.find((o) => o.m === "eq" && o.a[0] === "user_id")?.a[1]
        const ids = (q.ops.find((o) => o.m === "in")?.a[1] ?? []) as string[]
        return { data: jobs.rows.filter((r) => r.user_id === owner && ids.includes(String(r.id))), error: null }
      }),
    },
  }
})

vi.mock("../../canvas-result-ids.js", () => ({ resolveCanvasResultIds: async (nodes: unknown) => nodes }))
vi.mock("../../ugc-composed-graph.js", () => ({ ugcPublishedGraph: async (nodes: unknown) => ({ nodes }) }))
vi.mock("../../share-links/job-reads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../share-links/job-reads.js")>()),
  isRestrictedAddress: (url: string) => url === RESTRICTED,
}))
vi.mock("../../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config.js")>()
  return { ...actual, config: { ...actual.config, R2_PUBLIC_URL: "https://cdn.example" } }
})
const assets = vi.hoisted(() => ({ calls: [] as Array<{ ids: unknown; userId: string }> }))
vi.mock("../../workflow-assets.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../workflow-assets.js")>()
  return {
    ...actual,
    fetchExportAssets: async (ids: unknown, userId: string) => {
      assets.calls.push({ ids, userId })
      return { characters: [], objects: [], creatures: [], locations: [] }
    },
  }
})

import { projectWorkflowView, publicViewNodes, scrubPublicValue } from "../project.js"
import { buildViewExport } from "../export-snapshot.js"
import { readViewCard } from "../card-content.js"
import { viewCardHtml } from "../card.js"
import type { LiveViewLink, ViewedWorkflow } from "../store.js"

const SECRETS = [
  "whk_SECRET_TRIGGER_TOKEN_0123456789",
  "https://app.example/v1/webhooks/whk_SECRET_TRIGGER_TOKEN_0123456789",
  "https://hooks.example.com/owner-endpoint",
  "Bearer owner-header-token",
  "cred-owner-1",
  "tg-account-1",
  "987654321",
  "sk-owner-api-key",
  "owner-password",
  RESTRICTED,
  "hidden node prompt",
  PRIVATE_RESULT,
  "https://cdn.example/audios/voice-source.wav",
  "https://cdn.example/audios/voice-consent.wav",
  "consent-signature-abc",
  "https://cdn.example/audios/suno-voice.wav",
  "suno-persona-1",
  "tg-connection-1",
  "-100555",
  "my private request to the assistant",
  "studio draft text",
]

function fixture(): ViewedWorkflow {
  return {
    id: "w1",
    name: "Astronaut mockup",
    user_id: OWNER,
    settings: {
      presentationSettings: { runTarget: "workflow" },
      apiKey: "sk-owner-api-key",
      cover: RESTRICTED,
      mcpConversation: { firstRequest: "my private request to the assistant" },
      studio: { draft: "studio draft text" },
      characterDefinitions: [{ id: "c1", name: "Maya", referenceImageUrl: RESTRICTED }],
    },
    nodes: [
      {
        id: "img",
        type: "generate-image",
        position: { x: 0, y: 0 },
        data: {
          label: "Hero shot",
          prompt: "an astronaut floating next to a phone",
          generatedImageUrl: "https://cdn.example/images/hero.png",
          generatedResults: [
            { url: "https://cdn.example/images/hero.png", jobId: PUBLIC_JOB },
            { url: RESTRICTED },
            { url: PRIVATE_RESULT, jobId: PRIVATE_JOB },
          ],
          activeResultIndex: 2,
        },
      },
      {
        id: "vid",
        type: "generate-video",
        position: { x: 400, y: 0 },
        data: { label: "Clip", prompt: "slow orbit", generatedResults: [{ url: "https://cdn.example/videos/v.mp4", thumbnailUrl: "https://cdn.example/thumbnails/v.jpg" }] },
      },
      { id: "note", type: "sticky-note", position: { x: 0, y: 400 }, data: { text: "Made for the article", title: "Notes" } },
      {
        id: "trig",
        type: "webhook-trigger",
        position: { x: -400, y: 0 },
        data: { label: "Hook", webhookToken: "whk_SECRET_TRIGGER_TOKEN_0123456789", webhookUrl: "https://app.example/v1/webhooks/whk_SECRET_TRIGGER_TOKEN_0123456789" },
      },
      {
        id: "out",
        type: "webhook-output",
        position: { x: 800, y: 0 },
        data: { label: "Send", url: "https://hooks.example.com/owner-endpoint", headers: { Authorization: "Bearer owner-header-token" }, credentialId: "cred-owner-1" },
      },
      {
        id: "tg",
        type: "telegram-account-trigger",
        position: { x: 800, y: 300 },
        data: { label: "Telegram", accountId: "tg-account-1", chatIds: ["987654321"] },
      },
      {
        id: "llm",
        type: "llm-chat",
        position: { x: 0, y: 800 },
        data: { label: "Writer", prompt: "write a caption", maxTokens: 800, options: { password: "owner-password" }, copiedFrom: "see https://app.example/v1/webhooks/whk_SECRET_TRIGGER_TOKEN_0123456789" },
      },
      {
        id: "tts",
        type: "text-to-speech",
        position: { x: 0, y: 1200 },
        data: {
          label: "Voice",
          text: "hello there",
          replica: { sourceAudioUrl: "https://cdn.example/audios/voice-source.wav", consentAudioUrl: "https://cdn.example/audios/voice-consent.wav" },
          replicaConsent: { userId: OWNER, signature: "consent-signature-abc" },
        },
      },
      {
        id: "sv",
        type: "suno-voice",
        position: { x: 0, y: 1500 },
        data: { label: "My voice", sourceAudioUrl: "https://cdn.example/audios/suno-voice.wav", voiceId: "suno-persona-1" },
      },
      {
        id: "tgb",
        type: "telegram-trigger",
        position: { x: 0, y: 1800 },
        data: { label: "Bot", connectionId: "tg-connection-1", chatIdFilter: "-100555" },
      },
      { id: "ghost", type: "generate-image", hidden: true, position: { x: 0, y: 0 }, data: { prompt: "hidden node prompt" } },
    ],
    edges: [
      { id: "e1", source: "img", target: "vid" },
      { id: "e2", source: "ghost", target: "vid" },
    ],
  }
}

const live = (): LiveViewLink => ({
  link: { workflow_id: "w1", owner_id: OWNER, token: "T".repeat(43), indexable: true, locale: "he", export_includes_assets: null, exported_at: null, created_at: "x" },
  workflow: fixture(),
})

function expectNoSecrets(label: string, text: string): void {
  for (const secret of SECRETS) {
    expect(text.includes(secret), `${label} carries ${secret}`).toBe(false)
  }
}

beforeEach(() => {
  assets.calls.length = 0
  jobs.rows.length = 0
  jobs.rows.push(
    { id: PRIVATE_JOB, user_id: OWNER, input_data: { prompt: "x" }, restricted_at: null, force_private: true },
    { id: PUBLIC_JOB, user_id: OWNER, input_data: { prompt: "x" }, restricted_at: null, force_private: false },
  )
})

describe("the public projection", () => {
  it("the canvas carries no secret, destination, restricted address or hidden node", async () => {
    const view = await projectWorkflowView({ ...fixture(), ownerId: OWNER })
    expectNoSecrets("the canvas", JSON.stringify(view))
    expect(view.nodes.map((n) => n.id)).toEqual(["img", "vid", "note", "trig", "out", "tg", "llm", "tts", "sv", "tgb"])
    expect(view.edges.map((e) => e.id)).toEqual(["e1"])
  })

  it("keeps what the canvas is for: results, prompts, notes, a model's limits", async () => {
    const view = await projectWorkflowView({ ...fixture(), ownerId: OWNER })
    const byId = Object.fromEntries(view.nodes.map((n) => [n.id, n.data ?? {}]))
    expect(byId.img!.prompt).toBe("an astronaut floating next to a phone")
    expect(byId.img!.generatedImageUrl).toBe("https://cdn.example/images/hero.png")
    // A restricted result, and one a share link would refuse (kept private), are dropped from the list;
    // the active index pointed at one and now shows the first left.
    expect(byId.img!.generatedResults).toEqual([{ url: "https://cdn.example/images/hero.png", jobId: PUBLIC_JOB }])
    expect(byId.img!.activeResultIndex).toBe(0)
    expect(byId.tts).toEqual({ label: "Voice", text: "hello there" })
    expect(byId.note!.text).toBe("Made for the article")
    expect(byId.llm!.maxTokens).toBe(800)
    // A sending node keeps its name only.
    expect(byId.out).toEqual({ label: "Send" })
    expect(byId.trig).toEqual({ label: "Hook" })
  })

  it("the card names no secret and draws only the canvas's own results", async () => {
    const { content, text } = await readViewCard(live())
    const html = viewCardHtml(content, { cardUrl: "https://app.example/view/x", defaultImage: null, indexable: true }, text).html
    expectNoSecrets("the card", JSON.stringify({ content, text }) + html)
    expect(content.picture).toEqual({ kind: "grid", sources: ["https://cdn.example/images/hero.png", "https://cdn.example/thumbnails/v.jpg"] })
    expect(content.title).toBe("Astronaut mockup · זרימת עבודה")
    expect(content.description).toBe("זרימת עבודה ב-9 שלבים שנוצרה עם Nodaro")
    expect(text).toContain("Made for the article")
  })

  it("the frozen copy, with or without the entities, carries no secret and keeps the export shape", async () => {
    for (const includeAssets of [false, true]) {
      const built = await buildViewExport(fixture(), includeAssets, new Date("2026-11-23T12:00:00Z"))
      expect(built.ok).toBe(true)
      if (!built.ok) return
      expectNoSecrets(`the copy (assets: ${includeAssets})`, JSON.stringify(built.snapshot))
      expect(built.snapshot.version).toBe(1)
      expect(built.snapshot.exportedAt).toBe("2026-11-23T12:00:00.000Z")
      // Only the settings the canvas reads, scrubbed: no assistant conversation, no Studio draft, no app setup.
      expect(built.snapshot.settings).toEqual({ characterDefinitions: [{ id: "c1", name: "Maya", referenceImageUrl: null }] })
    }
    // The entities bundled are the owner's, read with the owner's id.
    expect(assets.calls.map((c) => c.userId)).toEqual([OWNER])
  })

  it("a copy without the entities is a clean template: the results are not in it", async () => {
    const built = await buildViewExport(fixture(), false)
    if (!built.ok) throw new Error("expected a copy")
    const img = built.snapshot.nodes.find((n) => n.id === "img")!
    expect((img.data as Record<string, unknown>).generatedImageUrl).toBeUndefined()
    expect((img.data as Record<string, unknown>).prompt).toBe("an astronaut floating next to a phone")
  })
})

describe("the scrub", () => {
  it("drops secret-named keys at any depth and leaves look-alikes alone", () => {
    expect(scrubPublicValue({ a: { b: { refreshToken: "x", apiKey: "y", tokenCount: 3, maxTokens: 9 } } })).toEqual({ a: { b: { tokenCount: 3, maxTokens: 9 } } })
  })

  it("never mutates its input", () => {
    const nodes = [{ id: "n", type: "webhook-trigger", data: { label: "L", webhookToken: "t" } }]
    const frozen = JSON.stringify(nodes)
    publicViewNodes(nodes)
    expect(JSON.stringify(nodes)).toBe(frozen)
  })
})
