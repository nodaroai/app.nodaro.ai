import { describe, it, expect } from "vitest"
import type { Workflow } from "@nodaro/sdk"

import { parseProduction, serializeProduction } from "../shot-graph"
import type { Shot } from "../shot"

/**
 * FILM (production-wide) and SCENE LOOK (per scene) are presented as SETTINGS,
 * so they must survive a reload — they used to live only in component state and
 * silently reset to "Default" on refresh.
 */
const shot: Shot = {
  id: "shot-a",
  still: {
    nodeId: "generate-image-job1",
    url: "https://r2.example/a.png",
    provider: "nano-banana",
    prompt: "p",
  },
}

function roundTrip(shots: Shot[], film?: Record<string, string>) {
  const ser = serializeProduction(
    shots,
    "shot-a",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    film,
  )
  return parseProduction({
    id: "wf-1",
    projectId: "p",
    userId: "u",
    name: "n",
    nodes: ser.nodes,
    edges: ser.edges,
    settings: ser.settings,
    createdAt: "",
    updatedAt: "",
  } as unknown as Workflow)
}

describe("look persistence — a picked setting survives a reload", () => {
  it("round-trips the production-wide FILM layer", () => {
    const parsed = roundTrip([shot], {
      cameraFormatId: "35mm-film",
      colorLookId: "kodak-vision3",
    })
    expect(parsed.film).toEqual({
      cameraFormatId: "35mm-film",
      colorLookId: "kodak-vision3",
    })
  })

  it("round-trips a scene's OWN look, including a multi-pick dimension", () => {
    const parsed = roundTrip([
      { ...shot, look: { moodId: "tense", atmosphereId: ["fog", "smoke"] } },
    ])
    expect(parsed.shots[0].look).toEqual({
      moodId: "tense",
      atmosphereId: ["fog", "smoke"],
    })
  })

  it("stays byte-identical when nothing is picked", () => {
    const ser = serializeProduction([shot], "shot-a")
    const studio = ser.settings.studio as unknown as Record<string, unknown>
    expect("film" in studio).toBe(false)
    expect("look" in (studio.shots as Array<Record<string, unknown>>)[0]).toBe(false)
  })

  it("degrades a malformed look instead of throwing", () => {
    const ser = serializeProduction([shot], "shot-a")
    const studio = ser.settings.studio as unknown as {
      shots: Array<Record<string, unknown>>
      film?: unknown
    }
    studio.shots[0].look = { moodId: 42 }
    studio.film = "nonsense"
    const wf = {
      id: "wf-1",
      projectId: "p",
      userId: "u",
      name: "n",
      nodes: ser.nodes,
      edges: ser.edges,
      settings: ser.settings,
      createdAt: "",
      updatedAt: "",
    } as unknown as Workflow
    const parsed = parseProduction(wf)
    expect(parsed.shots[0].look).toBeUndefined()
    expect(parsed.film).toBeUndefined()
  })
})
