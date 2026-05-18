import { describe, it, expect, vi } from "vitest"
import {
  selectLoraRoutingForMentions,
  buildTriggerWord,
  collectTrainingImages,
  InsufficientImagesError,
} from "../character-lora.js"

describe("selectLoraRoutingForMentions", () => {
  it("returns the LoRA when exactly one trained character is mentioned", () => {
    const result = selectLoraRoutingForMentions([
      {
        characterSlug: "kira",
        loraReplicateVersion: "nodaroai/char-abc:hash123",
        loraTriggerWord: "TOK_kira_a1b2c3",
        loraTrainingStatus: "succeeded",
      },
    ])
    expect(result).toEqual({
      characterSlug: "kira",
      triggerWord: "TOK_kira_a1b2c3",
      loraVersion: "nodaroai/char-abc:hash123",
    })
  })

  it("returns null when no characters are mentioned", () => {
    expect(selectLoraRoutingForMentions([])).toBeNull()
  })

  it("returns null when the mentioned character has no LoRA version", () => {
    expect(
      selectLoraRoutingForMentions([
        {
          characterSlug: "kira",
          loraReplicateVersion: null,
          loraTriggerWord: null,
          loraTrainingStatus: null,
        },
      ]),
    ).toBeNull()
  })

  it("returns null when training is in flight (not yet succeeded)", () => {
    expect(
      selectLoraRoutingForMentions([
        {
          characterSlug: "kira",
          loraReplicateVersion: "nodaroai/char-abc:hash",
          loraTriggerWord: "TOK_kira_a1b2c3",
          loraTrainingStatus: "training",
        },
      ]),
    ).toBeNull()
  })

  it("returns null when training failed", () => {
    expect(
      selectLoraRoutingForMentions([
        {
          characterSlug: "kira",
          loraReplicateVersion: null,
          loraTriggerWord: null,
          loraTrainingStatus: "failed",
        },
      ]),
    ).toBeNull()
  })

  it("returns null when two DISTINCT trained characters are mentioned (multi-LoRA = Phase 2)", () => {
    expect(
      selectLoraRoutingForMentions([
        {
          characterSlug: "kira",
          loraReplicateVersion: "nodaroai/char-abc:hash1",
          loraTriggerWord: "TOK_kira_a1b2c3",
          loraTrainingStatus: "succeeded",
        },
        {
          characterSlug: "jin",
          loraReplicateVersion: "nodaroai/char-def:hash2",
          loraTriggerWord: "TOK_jin_d4e5f6",
          loraTrainingStatus: "succeeded",
        },
      ]),
    ).toBeNull()
  })

  it("returns the LoRA when ONE character has multiple variant refs (same slug, different variants)", () => {
    // The user wired @kira:1:canonical + @kira:2:smile — both refs point to
    // the same character (slug=kira), so distinctSlugs.size === 1 and the
    // LoRA path should still fire.
    const result = selectLoraRoutingForMentions([
      {
        characterSlug: "kira",
        loraReplicateVersion: "nodaroai/char-abc:hash",
        loraTriggerWord: "TOK_kira_a1b2c3",
        loraTrainingStatus: "succeeded",
      },
      {
        characterSlug: "kira",
        loraReplicateVersion: "nodaroai/char-abc:hash",
        loraTriggerWord: "TOK_kira_a1b2c3",
        loraTrainingStatus: "succeeded",
      },
    ])
    expect(result?.characterSlug).toBe("kira")
  })

  it("ignores refs without a characterSlug (manual / wired-image / wired-object)", () => {
    // The autocomplete may pass non-character refs alongside character ones.
    // distinctSlugs should only count the character ones.
    const result = selectLoraRoutingForMentions([
      { characterSlug: undefined, loraReplicateVersion: null, loraTriggerWord: null, loraTrainingStatus: null },
      {
        characterSlug: "kira",
        loraReplicateVersion: "nodaroai/char-abc:hash",
        loraTriggerWord: "TOK_kira_a1b2c3",
        loraTrainingStatus: "succeeded",
      },
    ])
    expect(result?.characterSlug).toBe("kira")
  })
})

describe("buildTriggerWord", () => {
  it("emits TOK_<slug>_<6hex> format for a normal name", () => {
    // randomBytes is non-deterministic; just check shape.
    const trigger = buildTriggerWord("Kira")
    expect(trigger).toMatch(/^TOK_kira_[0-9a-f]{6}$/)
  })

  it("falls back to 'char' for an empty/symbolic-only name", () => {
    expect(buildTriggerWord("")).toMatch(/^TOK_char_[0-9a-f]{6}$/)
    expect(buildTriggerWord("!!!")).toMatch(/^TOK_char_[0-9a-f]{6}$/)
  })

  it("normalizes spaces and special chars via characterMentionSlug", () => {
    // characterMentionSlug strips/replaces; result is lowercase + alnum + hyphens.
    const trigger = buildTriggerWord("Mr. Smith Jones")
    expect(trigger).toMatch(/^TOK_[a-z0-9-]+_[0-9a-f]{6}$/)
    expect(trigger).not.toContain(" ")
    expect(trigger).not.toContain(".")
  })
})

describe("collectTrainingImages", () => {
  it("aggregates all 7 buckets in priority order, de-duped", () => {
    const images = collectTrainingImages({
      source_image_url: "https://r2/source.jpg",
      reference_photos: [{ url: "https://r2/ref-front.jpg", kind: "frontFace" }],
      expressions: [{ url: "https://r2/expr-smile.jpg", name: "smile" }],
      poses: [{ url: "https://r2/pose-standing.jpg", name: "standing" }],
      angles: [{ url: "https://r2/angle-front.jpg", name: "front" }],
      body_angles: [{ url: "https://r2/body-front.jpg", name: "front" }],
      lighting_variations: [{ url: "https://r2/light-noir.jpg", name: "noir" }],
    })
    expect(images).toHaveLength(7)
    expect(images[0].url).toBe("https://r2/source.jpg")
    expect(images[0].label).toBe("source")
    expect(images[images.length - 1].label).toBe("light_noir")
  })

  it("throws InsufficientImagesError when fewer than 4 URLs available", () => {
    expect(() =>
      collectTrainingImages({
        source_image_url: "https://r2/source.jpg",
        reference_photos: [{ url: "https://r2/ref.jpg", kind: "frontFace" }],
      }),
    ).toThrow(InsufficientImagesError)
  })

  it("dedupes URLs that appear in multiple buckets", () => {
    const images = collectTrainingImages({
      source_image_url: "https://r2/shared.jpg",
      reference_photos: [
        { url: "https://r2/shared.jpg", kind: "frontFace" },
        { url: "https://r2/b.jpg", kind: "sideLeft" },
        { url: "https://r2/c.jpg", kind: "sideRight" },
        { url: "https://r2/d.jpg", kind: "frontBody" },
      ],
    })
    // source + 3 unique ref_photos (4th was the dup) = 4
    expect(images.map((i) => i.url)).toEqual([
      "https://r2/shared.jpg",
      "https://r2/b.jpg",
      "https://r2/c.jpg",
      "https://r2/d.jpg",
    ])
  })

  it("caps at 20 even when more are available", () => {
    const refs = Array.from({ length: 30 }, (_, i) => ({
      url: `https://r2/ref-${i}.jpg`,
      kind: "other",
    }))
    const images = collectTrainingImages({
      source_image_url: "https://r2/source.jpg",
      reference_photos: refs,
    })
    expect(images).toHaveLength(20)
  })

  it("skips entries with no url", () => {
    const images = collectTrainingImages({
      source_image_url: "https://r2/source.jpg",
      expressions: [
        { url: "https://r2/expr1.jpg", name: "smile" },
        { url: "", name: "empty" },
        { name: "no-url-at-all" } as { url?: string; name?: string },
        { url: "https://r2/expr2.jpg", name: "frown" },
        { url: "https://r2/expr3.jpg", name: "angry" },
      ],
    })
    expect(images.map((i) => i.label)).toEqual([
      "source",
      "expr_smile",
      "expr_frown",
      "expr_angry",
    ])
  })
})

describe("deleteCharacterLora (Bearer header regression net)", () => {
  it("calls fetch with Authorization: Bearer ${REPLICATE_API_TOKEN}", async () => {
    // Mock fetch — assert the URL + Authorization header shape.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }))

    const { deleteCharacterLora } = await import("../../providers/replicate/training.js")
    await deleteCharacterLora("nodaroai/char-test-uuid")

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.replicate.com/v1/models/nodaroai/char-test-uuid",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      }),
    )
    fetchSpy.mockRestore()
  })

  it("swallows 404 (idempotent — model already deleted)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 404 }))

    const { deleteCharacterLora } = await import("../../providers/replicate/training.js")
    // Should NOT throw.
    await expect(deleteCharacterLora("nodaroai/char-gone")).resolves.toBeUndefined()
    fetchSpy.mockRestore()
  })

  it("logs but does not throw on network error", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network down"))

    const { deleteCharacterLora } = await import("../../providers/replicate/training.js")
    await expect(deleteCharacterLora("nodaroai/char-x")).resolves.toBeUndefined()
    fetchSpy.mockRestore()
  })
})
