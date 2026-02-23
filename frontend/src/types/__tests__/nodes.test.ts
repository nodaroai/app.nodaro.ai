import { describe, it, expect } from "vitest"

import type {
  ScriptScene,
  ScriptSceneCharacter,
  ScriptSceneDialogue,
} from "../nodes.js"
import {
  getSceneCharacterNames,
  getSceneMoodDisplay,
  mapScriptSceneToNodeData,
} from "../nodes.js"

function makeScene(overrides: Partial<ScriptScene> = {}): ScriptScene {
  return {
    sceneNumber: 1,
    visualDescription: "A dark forest",
    action: "The hero walks",
    mood: "tense",
    durationHint: 5,
    imagePrompt: "dark forest scene",
    ...overrides,
  } as ScriptScene
}

// ---------------------------------------------------------------------------
// getSceneCharacterNames
// ---------------------------------------------------------------------------

describe("getSceneCharacterNames", () => {
  it("returns empty array for undefined", () => {
    expect(getSceneCharacterNames(undefined)).toEqual([])
  })

  it("returns empty array for empty array", () => {
    expect(getSceneCharacterNames([])).toEqual([])
  })

  it("returns string names from string[]", () => {
    const names = ["Alice", "Bob", "Charlie"]
    expect(getSceneCharacterNames(names)).toEqual(["Alice", "Bob", "Charlie"])
  })

  it("returns names from ScriptSceneCharacter[]", () => {
    const characters: ScriptSceneCharacter[] = [
      { name: "Hero", description: "brave", mood: "determined", action: "walks" },
      { name: "Villain", description: "menacing", mood: "angry", action: "lurks" },
    ]
    expect(getSceneCharacterNames(characters)).toEqual(["Hero", "Villain"])
  })

  it("preserves order", () => {
    const characters: ScriptSceneCharacter[] = [
      { name: "Zara", description: "", mood: "", action: "" },
      { name: "Anna", description: "", mood: "", action: "" },
      { name: "Mira", description: "", mood: "", action: "" },
    ]
    expect(getSceneCharacterNames(characters)).toEqual(["Zara", "Anna", "Mira"])
  })
})

// ---------------------------------------------------------------------------
// getSceneMoodDisplay
// ---------------------------------------------------------------------------

describe("getSceneMoodDisplay", () => {
  it("returns joined string for array", () => {
    expect(getSceneMoodDisplay(["tense", "dark", "mysterious"])).toBe(
      "tense, dark, mysterious",
    )
  })

  it("returns string as-is for string", () => {
    expect(getSceneMoodDisplay("hopeful")).toBe("hopeful")
  })

  it("returns empty string for undefined", () => {
    expect(getSceneMoodDisplay(undefined as any)).toBe("")
  })

  it("handles single-element array", () => {
    expect(getSceneMoodDisplay(["calm"])).toBe("calm")
  })
})

// ---------------------------------------------------------------------------
// mapScriptSceneToNodeData
// ---------------------------------------------------------------------------

describe("mapScriptSceneToNodeData", () => {
  it("maps basic fields", () => {
    const scene = makeScene({
      sceneName: "Forest Entrance",
      visualDescription: "Tall dark trees",
      duration: 8,
      durationHint: 5,
      imagePrompt: "forest prompt",
      action: "Walking forward",
    })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.sceneName).toBe("Forest Entrance")
    expect(result.summary).toBe("Tall dark trees")
    expect(result.duration).toBe(8)
    expect(result.generatedPrompt).toBe("forest prompt")
    expect(result.narration).toBe("Walking forward")
  })

  it("prefers duration over durationHint", () => {
    const scene = makeScene({ duration: 12, durationHint: 5 })
    expect(mapScriptSceneToNodeData(scene).duration).toBe(12)
  })

  it("falls back to durationHint when duration is missing", () => {
    const scene = makeScene({ durationHint: 7 })
    expect(mapScriptSceneToNodeData(scene).duration).toBe(7)
  })

  it("maps string[] characters to SceneCharacterEntry[] with empty fields", () => {
    const scene = makeScene({ characters: ["Alice", "Bob"] })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.characters).toHaveLength(2)
    expect(result.characters![0]).toEqual({ assetId: "", mood: "", action: "" })
    expect(result.characters![1]).toEqual({ assetId: "", mood: "", action: "" })
  })

  it("maps ScriptSceneCharacter[] with mood, action, position", () => {
    const characters: ScriptSceneCharacter[] = [
      { name: "Hero", description: "brave", mood: "determined", action: "runs", position: "left" },
      { name: "Sidekick", description: "loyal", mood: "nervous", action: "follows" },
    ]
    const scene = makeScene({ characters })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.characters).toHaveLength(2)
    expect(result.characters![0]).toEqual({
      assetId: "",
      mood: "determined",
      action: "runs",
      positionInFrame: "left",
    })
    expect(result.characters![1]).toEqual({
      assetId: "",
      mood: "nervous",
      action: "follows",
      positionInFrame: undefined,
    })
  })

  it("maps dialogue entries", () => {
    const dialogue: ScriptSceneDialogue[] = [
      { speaker: "Hero", text: "Let's go!", emotion: "excited" },
      { speaker: "Villain", text: "Not so fast." },
    ]
    const scene = makeScene({ dialogue })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.dialogue).toHaveLength(2)
    expect(result.dialogue![0]).toEqual({
      characterId: undefined,
      characterName: "Hero",
      text: "Let's go!",
      emotion: "excited",
    })
    expect(result.dialogue![1]).toEqual({
      characterId: undefined,
      characterName: "Villain",
      text: "Not so fast.",
      emotion: undefined,
    })
  })

  it("maps location to locations array with isPrimary=true", () => {
    const scene = makeScene({
      location: {
        name: "Dark Forest",
        description: "A spooky forest",
        timeOfDay: "night",
        weather: "foggy",
        lighting: "dramatic",
      },
    })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.locations).toHaveLength(1)
    expect(result.locations![0]).toEqual({
      assetId: "",
      name: "Dark Forest",
      isPrimary: true,
      timeOfDay: "night",
      weather: "foggy",
      lighting: "dramatic",
    })
  })

  it("handles empty/missing characters", () => {
    const scene = makeScene({ characters: undefined })
    expect(mapScriptSceneToNodeData(scene).characters).toEqual([])
  })

  it("handles empty/missing dialogue", () => {
    const scene = makeScene({ dialogue: undefined })
    expect(mapScriptSceneToNodeData(scene).dialogue).toEqual([])
  })

  it("handles empty/missing location", () => {
    const scene = makeScene({ location: undefined })
    expect(mapScriptSceneToNodeData(scene).locations).toEqual([])
  })

  it("normalizes string mood to single-element array", () => {
    const scene = makeScene({ mood: "tense" })
    expect(mapScriptSceneToNodeData(scene).mood).toEqual(["tense"])
  })

  it("normalizes array mood to array (spread copy)", () => {
    const originalMood = ["tense", "dark"]
    const scene = makeScene({ mood: originalMood })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.mood).toEqual(["tense", "dark"])
    expect(result.mood).not.toBe(originalMood)
  })

  it("handles missing mood", () => {
    const scene = makeScene({ mood: undefined } as any)
    expect(mapScriptSceneToNodeData(scene).mood).toEqual([])
  })

  it("maps musicMood and soundEffects", () => {
    const scene = makeScene({
      musicMood: "epic",
      soundEffects: ["thunder", "wind"],
    })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.musicMood).toBe("epic")
    expect(result.soundEffects).toEqual(["thunder", "wind"])
  })

  it("maps cinematography fields", () => {
    const scene = makeScene({
      cinematography: {
        shotType: "wide",
        cameraAngle: "low-angle",
        cameraMovement: "dolly",
      },
    })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.shotType).toBe("wide")
    expect(result.cameraAngle).toBe("low-angle")
    expect(result.cameraMovement).toBe("dolly")
  })

  it("maps location metadata (timeOfDay, weather, lighting)", () => {
    const scene = makeScene({
      location: {
        name: "Beach",
        description: "Sandy shore",
        timeOfDay: "sunset",
        weather: "clear",
        lighting: "natural",
      },
    })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.timeOfDay).toBe("sunset")
    expect(result.weather).toBe("clear")
    expect(result.lighting).toBe("natural")
  })

  it("carries over generatedImages when present", () => {
    const scene = makeScene({
      generatedImages: [
        { url: "https://img1.png", timestamp: "2026-01-01T00:00:00Z", jobId: "j1" },
        { url: "https://img2.png", timestamp: "2026-01-02T00:00:00Z", jobId: "j2" },
      ],
      activeImageIndex: 1,
    })
    const result = mapScriptSceneToNodeData(scene)

    expect(result.generatedResults).toHaveLength(2)
    expect(result.generatedResults![0]).toEqual({
      url: "https://img1.png",
      timestamp: "2026-01-01T00:00:00Z",
      jobId: "j1",
    })
    expect(result.activeResultIndex).toBe(1)
    expect(result.generatedImageUrl).toBe("https://img2.png")
  })

  it("does not set generatedImages fields when no images", () => {
    const scene = makeScene()
    const result = mapScriptSceneToNodeData(scene)

    expect(result.generatedResults).toBeUndefined()
    expect(result.activeResultIndex).toBeUndefined()
    expect(result.generatedImageUrl).toBeUndefined()
  })
})
