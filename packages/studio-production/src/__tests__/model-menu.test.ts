import { describe, it, expect } from "vitest"
import {
  MODIFY_IMAGE_PROVIDERS,
  NATIVE_NEGATIVE_PROMPT_MODELS,
  NATIVE_NEGATIVE_VIDEO_PROVIDERS,
  modelIdsByKindMode,
  videoProviderRequiresImage,
} from "@nodaro/shared"
import {
  DEFAULT_IMAGE_PROVIDER,
  DEFAULT_ASSET_IMAGE_PROVIDER,
  DEFAULT_EDIT_IMAGE_PROVIDER,
  DEFAULT_FRAMING_PROVIDER,
  DEFAULT_VIDEO_PROVIDER,
  EDIT_IMAGE_MODEL_ALLOWLIST,
  EDIT_IMAGE_MODEL_OPTIONS,
  editSafeProvider,
  getMaxNegativePromptChars,
  negativePromptSupported,
  DEFAULT_FRAMING_ASPECT,
  DEFAULT_FRAMING_RESOLUTION,
  DEFAULT_DIRECTING_ASPECT,
  EMOTION_VIDEO_DEFAULT_PROVIDER,
  EMOTION_VIDEO_MODEL_OPTIONS,
  IMAGE_MODEL_OPTIONS,
  FRAMING_IMAGE_MODEL_OPTIONS,
  imageReferenceLimit,
  VIDEO_MODEL_OPTIONS,
  imageModelOptions,
  videoModelOptions,
  videoModelCards,
  imageQualityControl,
  defaultImageQuality,
  DEFAULT_ENTITY_RESOLUTION,
  videoReferenceSupported,
  videoReferenceCap,
  videoReferenceLimits,
  videoSupportsStartFrame,
  videoSupportsEndFrame,
  videoSupportsMode,
  supportedDirectingModes,
  defaultVideoResolution,
  videoResolutionLever,
  DIRECTING_RESOLUTION_AUTO,
  DIRECTING_MODES,
  DEFAULT_DIRECTING_MODE,
  STORYBOARD_DIRECTING_PROVIDER,
  STORYBOARD_DIRECTING_MODE,
  videoDurationOptions,
  nearestDuration,
  defaultDirectingModeFor,
  videoAudioField,
  videoModelCanSpeakDialogue,
  buildVideoCreditModelIdentifier,
  videoSupportsPromptOnly,
} from "../model-menu"

describe("model menu — image defaults", () => {
  // The default image model drives composer framing AND all entity
  // (character/location/object) generation, since DEFAULT_ENTITY_PROVIDER ===
  // DEFAULT_IMAGE_PROVIDER. Guard that it stays a real, selectable model so an
  // allowlist/catalog change can't leave the app with a broken default.
  //
  // NOTE: reference support is assumed for EVERY image model (Nodaro owns
  // reference handling), so it is intentionally NOT gated here — picking the
  // default is a quality/preference choice, not a capability check.
  it("default image model is a valid, selectable option", () => {
    expect(IMAGE_MODEL_OPTIONS.some((o) => o.value === DEFAULT_IMAGE_PROVIDER)).toBe(true)
  })

  // gpt-image-2 is a curated option; pin that it stays exposed in the picker.
  it("exposes gpt-image-2 as a selectable image model", () => {
    expect(IMAGE_MODEL_OPTIONS.some((o) => o.value === "gpt-image-2")).toBe(true)
  })

  // Derived shots (angles / group assets / variations, fired after the main
  // image is approved) default to GPT Image 2 — a SEPARATE knob from the
  // creation default, so the menu's lead order can change without silently
  // moving the asset model. Pin the id, that it is selectable, and that it
  // still carries reference support (the asset routes anchor each derived shot
  // on the approved main image).
  it("asset shots default to gpt-image-2, distinct from the creation default", () => {
    expect(DEFAULT_ASSET_IMAGE_PROVIDER).toBe("gpt-image-2")
    expect(DEFAULT_ASSET_IMAGE_PROVIDER).not.toBe(DEFAULT_IMAGE_PROVIDER)
    expect(
      IMAGE_MODEL_OPTIONS.some((o) => o.value === DEFAULT_ASSET_IMAGE_PROVIDER),
    ).toBe(true)
    expect(imageReferenceLimit(DEFAULT_ASSET_IMAGE_PROVIDER)).toBeGreaterThan(0)
  })

  // The Framing picker now exposes EVERY catalog text-to-image model (not a
  // hardcoded 5), so models beyond the curated lead appear automatically — with
  // the curated quality still heading the list.
  it("includes far more than the old hand-listed 5, preferred leading", () => {
    expect(IMAGE_MODEL_OPTIONS.length).toBeGreaterThan(5)
    expect(IMAGE_MODEL_OPTIONS[0]?.value).toBe("nano-banana-pro")
  })
})

describe("model menu — negative prompt (native support)", () => {
  // The gate MIRRORS the platform's own native sets — image (Imagen / Ideogram /
  // Qwen families) and video (Kling / Wan) — never a hardcoded studio list, so
  // a platform set change flows through without a studio edit.
  it("mirrors the shared native sets for both kinds", () => {
    for (const id of NATIVE_NEGATIVE_PROMPT_MODELS) {
      expect(negativePromptSupported("image", id), id).toBe(true)
    }
    for (const id of NATIVE_NEGATIVE_VIDEO_PROVIDERS) {
      expect(negativePromptSupported("video", id), id).toBe(true)
    }
    // Both sets are non-empty (the field exists somewhere) — a platform export
    // rename would empty them silently without this.
    expect(NATIVE_NEGATIVE_PROMPT_MODELS.size).toBeGreaterThan(0)
    expect(NATIVE_NEGATIVE_VIDEO_PROVIDERS.size).toBeGreaterThan(0)
  })

  it("non-native models are gated off (the field hides; the hooks drop the value)", () => {
    expect(negativePromptSupported("image", DEFAULT_IMAGE_PROVIDER)).toBe(false)
    expect(negativePromptSupported("image", "gpt-image-2")).toBe(false)
    expect(negativePromptSupported("video", "veo3.1")).toBe(false)
    expect(negativePromptSupported("video", "seedance-2")).toBe(false)
  })

  it("the per-model char cap is a positive maxLength for native models", () => {
    for (const id of NATIVE_NEGATIVE_PROMPT_MODELS) {
      expect(getMaxNegativePromptChars(id), id).toBeGreaterThan(0)
    }
    for (const id of NATIVE_NEGATIVE_VIDEO_PROVIDERS) {
      expect(getMaxNegativePromptChars(id), id).toBeGreaterThan(0)
    }
  })
})

describe("model menu — faithful-edit models (RestyleChat Edit mode)", () => {
  // The edit menu is catalog ∩ route enum — every offered id must be one the
  // platform's image-to-image route actually accepts, or the Edit submit 400s.
  it("every edit model is accepted by the image-to-image route enum", () => {
    const routeAccepts = new Set<string>(MODIFY_IMAGE_PROVIDERS)
    for (const id of EDIT_IMAGE_MODEL_ALLOWLIST) {
      expect(routeAccepts.has(id), `"${id}" not in MODIFY_IMAGE_PROVIDERS`).toBe(true)
    }
  })

  // ...and every offered id declares an instruction-edit mode in the catalog
  // (i2i / edit) — the menu can't smuggle in a t2i-only model.
  it("every edit model declares an i2i/edit catalog mode", () => {
    const editCapable = new Set(modelIdsByKindMode("image", ["i2i", "edit"]))
    for (const id of EDIT_IMAGE_MODEL_ALLOWLIST) {
      expect(editCapable.has(id), `"${id}" has no i2i/edit mode`).toBe(true)
    }
  })

  // Pin the curated identity-preserving default (the platform's own guidance:
  // nano-banana-pro preserves character identity best across edits).
  it("defaults to nano-banana-pro — a real, selectable edit option", () => {
    expect(DEFAULT_EDIT_IMAGE_PROVIDER).toBe("nano-banana-pro")
    expect(
      EDIT_IMAGE_MODEL_OPTIONS.some((o) => o.value === DEFAULT_EDIT_IMAGE_PROVIDER),
    ).toBe(true)
  })

  // The menu is non-empty and shaped like every other picker menu.
  it("offers a non-trivial shaped menu", () => {
    expect(EDIT_IMAGE_MODEL_OPTIONS.length).toBeGreaterThan(3)
    expect(
      EDIT_IMAGE_MODEL_OPTIONS.every((o) => o.value.length > 0 && o.label.length > 0),
    ).toBe(true)
  })

  // The i2i-route coercion — what every adapter i2i call runs through AND what
  // shim-backed variation forms seed/display with. Pinned together so what the
  // form SHOWS can't drift from what the call RUNS.
  it("editSafeProvider passes edit ids and coerces everything else to the edit default", () => {
    expect(editSafeProvider(DEFAULT_EDIT_IMAGE_PROVIDER)).toBe(DEFAULT_EDIT_IMAGE_PROVIDER)
    // The derived-shot default is a t2i id — on the edit route it coerces.
    expect(editSafeProvider(DEFAULT_ASSET_IMAGE_PROVIDER)).toBe(DEFAULT_EDIT_IMAGE_PROVIDER)
    expect(editSafeProvider(undefined)).toBe(DEFAULT_EDIT_IMAGE_PROVIDER)
  })
})

describe("model menu — image quality control (catalog-driven)", () => {
  it("resolution-tier models expose a resolution control", () => {
    const c = imageQualityControl("nano-banana-pro")
    expect(c?.param).toBe("resolution")
    expect(c?.options.map((o) => o.value)).toContain("2K")
  })

  it("quality-tier models expose a quality control", () => {
    const c = imageQualityControl("seedream-5-lite")
    expect(c?.param).toBe("quality")
    expect(c?.options.map((o) => o.value)).toEqual(
      expect.arrayContaining(["basic", "high"]),
    )
  })

  it("returns null for a model with no quality lever", () => {
    expect(imageQualityControl("totally-not-a-real-model")).toBeNull()
  })
})

describe("model menu — video picker (all catalog models)", () => {
  // The Directing picker now exposes EVERY catalog video model (not a hardcoded
  // 6), so good models like Gemini Omni appear automatically.
  it("includes far more than the old hand-listed 6, e.g. Gemini Omni", () => {
    expect(VIDEO_MODEL_OPTIONS.length).toBeGreaterThan(6)
    expect(VIDEO_MODEL_OPTIONS.some((o) => o.value === "gemini-omni-video")).toBe(
      true,
    )
  })

  // The curated LEAD order (user decision 2026-08-10): the Seedance family
  // first (2.5 is the default), minimax-h3 third. Pinned like the defaults —
  // a catalog/preferred-list change must not silently reshuffle the top rows.
  it("leads with Seedance 2.5 · Seedance 2 · minimax-h3", () => {
    expect(VIDEO_MODEL_OPTIONS.slice(0, 3).map((o) => o.value)).toEqual([
      "seedance-2-5",
      "seedance-2",
      "minimax-h3",
    ])
  })

  // Since the Text input mode landed, the menu spans i2v ∪ t2v: pure
  // text-to-video models are INCLUDED (they surface under the Text tab alone).
  // The invariant is now "every row can drive SOME directing mode" — asserted
  // via videoSupportsMode (not pinned ids), so it survives catalog churn.
  it("every option supports at least one directing mode", () => {
    const MODES = ["start", "start-end", "references", "text"] as const
    expect(
      VIDEO_MODEL_OPTIONS.every((o) =>
        MODES.some((m) => videoSupportsMode(o.value, m)),
      ),
    ).toBe(true)
  })

  // A t2v-only model (no `i2v`) is now a real menu row — prompt-only capable,
  // start-frame incapable. Exemplar DERIVED from the catalog, never pinned.
  it("includes pure text-to-video models (prompt-only, no start frame)", () => {
    const t2vOnly = VIDEO_MODEL_OPTIONS.find(
      (o) => !videoSupportsStartFrame(o.value),
    )
    expect(t2vOnly).toBeDefined()
    expect(videoSupportsPromptOnly(t2vOnly!.value)).toBe(true)
  })
})

describe("model menu — video capability cards (rich picker)", () => {
  const byId = (id: string) =>
    videoModelCards().find((c) => c.value === id)

  // Cards mirror the directing menu exactly (same rows, same curated order) —
  // the picker is a richer view of VIDEO_MODEL_OPTIONS, never a divergent set.
  it("mirror the directing menu rows, in order", () => {
    expect(videoModelCards().map((c) => c.value)).toEqual(
      VIDEO_MODEL_OPTIONS.map((o) => o.value),
    )
  })

  // Each card's frame + prompt-only flags mirror the capability helpers exactly
  // (asserted for EVERY row, not pinned ids) — a t2v-only card reads startFrame
  // false + promptOnly true, an i2v card startFrame true; the tabs filter on
  // these, so a drift here would put a model under a tab it can't drive.
  it("mirrors start-frame + prompt-only capability per card", () => {
    for (const c of videoModelCards()) {
      expect(c.capabilities.startFrame, c.value).toBe(
        videoSupportsStartFrame(c.value),
      )
      expect(c.capabilities.promptOnly, c.value).toBe(
        videoSupportsPromptOnly(c.value),
      )
    }
  })

  // End-frame support distinguishes the interpolating models (kling-3.0) from the
  // start-only ones (grok-i2v) — the picker lights vs dims the track's End node.
  it("flags end-frame support per model", () => {
    expect(byId("kling-3.0")?.capabilities.endFrame).toBe(true)
    expect(byId("grok-i2v")?.capabilities.endFrame).toBe(false)
  })

  // The card carries the catalog's per-kind reference caps VERBATIM (the exact
  // numbers are pinned in the multi-type suite below) — so the picker's per-kind
  // breakdown can never drift from the helper. `referencesSupported` mirrors
  // "accepts any kind": true for a reference model, false for a frame-only one.
  it("wires through the per-kind reference caps + the supported flag", () => {
    const seed = byId("seedance-2")
    expect(seed?.capabilities.references).toEqual(
      videoReferenceLimits("seedance-2"),
    )
    expect(seed?.capabilities.referencesSupported).toBe(true)
    expect(byId("kling-3.0")?.capabilities.references).toEqual(
      videoReferenceLimits("kling-3.0"),
    )
    expect(byId("kling-3.0")?.capabilities.referencesSupported).toBe(false)
  })
})

describe("model menu — directing input modes (the model-first picker)", () => {
  // The MODEL-FIRST picker (user decision 2026-08-18): pick the model, then the
  // Input control offers ONLY its supported modes. supportedDirectingModes is
  // that option set — per model, in the canonical DIRECTING_MODES order.

  // Membership mirrors videoSupportsMode for EVERY menu model, in canonical
  // order, and is never empty (every menu row can drive SOME mode).
  it("offers exactly the supported modes, in canonical order, for every model", () => {
    for (const o of VIDEO_MODEL_OPTIONS) {
      const modes = supportedDirectingModes(o.value)
      expect(modes.length, o.value).toBeGreaterThan(0)
      expect(modes, o.value).toEqual(
        DIRECTING_MODES.filter((m) => videoSupportsMode(o.value, m)),
      )
    }
  })

  // The user's core ask: an unsupported mode is ABSENT, never offered. Pinned
  // exemplars for the two directions of the gate.
  it("omits modes a model can't drive (no Start+End on grok-i2v; no References on kling-3.0)", () => {
    expect(supportedDirectingModes("grok-i2v")).not.toContain("start-end")
    expect(supportedDirectingModes("kling-3.0")).not.toContain("references")
  })

  // A text-only model (no frames, no references) offers Text ALONE, and its
  // default mode resolves to "text" — the pair the picker/clamp restores.
  it("a text-only model offers Text alone and defaults to it", () => {
    const textOnly = VIDEO_MODEL_OPTIONS.find(
      (o) =>
        !videoSupportsStartFrame(o.value) && !videoReferenceSupported(o.value),
    )
    expect(textOnly).toBeDefined()
    const id = textOnly!.value
    expect(supportedDirectingModes(id)).toEqual(["text"])
    expect(defaultDirectingModeFor(id)).toBe("text")
  })

  // The default mode is the default model's CURATED mode — Seedance 2.5 is
  // curated to References (user decision 2026-08-08: reference-driven, not
  // keyframed), overriding the positional first-supported-mode fallback.
  it("defaults to References for the default model (curated)", () => {
    expect(DEFAULT_DIRECTING_MODE).toBe("references")
    expect(
      videoSupportsMode(DEFAULT_VIDEO_PROVIDER, DEFAULT_DIRECTING_MODE),
    ).toBe(true)
  })

  // Models WITHOUT a curated override keep the positional fallback — the first
  // DIRECTING_MODES entry they support (end-capable Seedance 2 → start-end).
  it("uncurated models keep the first-supported-mode fallback", () => {
    expect(defaultDirectingModeFor("seedance-2")).toBe("start-end")
    expect(defaultDirectingModeFor("grok-i2v")).toBe("references") // no end-frame
  })

  // The clamp contract: every model's default mode is one it actually offers —
  // a model switch can never land on a mode absent from its Input control.
  it("every model's default mode is among its supported modes", () => {
    for (const o of VIDEO_MODEL_OPTIONS) {
      expect(supportedDirectingModes(o.value), o.value).toContain(
        defaultDirectingModeFor(o.value),
      )
    }
  })

  // videoSupportsMode (the Studio submit's gate) — pinned capability exemplars.
  it("videoSupportsMode mirrors the capability helpers", () => {
    expect(videoSupportsMode("seedance-2", "references")).toBe(true)
    expect(videoSupportsMode("kling-3.0", "references")).toBe(false)
    expect(videoSupportsMode("grok-i2v", "start")).toBe(true)
    expect(videoSupportsMode("grok-i2v", "start-end")).toBe(false)
    expect(videoSupportsMode("kling-3.0", "start-end")).toBe(true)
  })

  // The Storyboard→Directing hand-off pins Seedance 2 + References (continuity:
  // drive the next shot from the previous frame as a reference image). Guard the
  // pair is VALID so the Studio mode clamp won't bounce it back to "start".
  it("Storyboard hand-off default is Seedance 2 + a valid References mode", () => {
    expect(STORYBOARD_DIRECTING_PROVIDER).toBe("seedance-2")
    expect(STORYBOARD_DIRECTING_MODE).toBe("references")
    expect(
      videoSupportsMode(STORYBOARD_DIRECTING_PROVIDER, STORYBOARD_DIRECTING_MODE),
    ).toBe(true)
  })
})

describe("model menu — video resolution lever (videoResolutionLever)", () => {
  const leverOf = (id: string) => {
    const menu = videoModelOptions().find((m) => m.id === id)
    return videoResolutionLever(id, menu?.resolutions ?? [])
  }

  // The lever's DEFAULT must be render- AND price-neutral for EVERY model:
  //  - a platform-DECLARED billing default pre-selects, and SENDING it must
  //    price identically to omitting the field (the declared value is both the
  //    billing and the render default);
  //  - any other model starts on Auto (nothing sent — trivially neutral, the
  //    provider's own default renders). A first-option guess is forbidden: a
  //    provider's real render default can differ from its cheapest option (the
  //    Seedance 2 family renders 720p when omitted; its first option is 480p).
  it("every model's default is Auto or a price-neutral declared value", () => {
    for (const o of VIDEO_MODEL_OPTIONS) {
      const lever = leverOf(o.value)
      if (lever.initial === DIRECTING_RESOLUTION_AUTO) {
        // Auto leads the options whenever it is the initial (and the control
        // hides entirely when the model has no options at all).
        if (lever.options.length > 0) {
          expect(lever.options[0].value, o.value).toBe(DIRECTING_RESOLUTION_AUTO)
        }
        continue
      }
      // Declared default: a member of the model's real catalog options, and
      // sending it prices exactly like omitting the field.
      expect(
        lever.options.some((opt) => opt.value === lever.initial),
        o.value,
      ).toBe(true)
      for (const duration of [undefined, 5, 8]) {
        for (const sound of [true, false]) {
          expect(
            buildVideoCreditModelIdentifier(
              o.value,
              duration,
              sound,
              "image-to-video",
              undefined,
              lever.initial,
            ),
            `${o.value} @ ${lever.initial}`,
          ).toBe(
            buildVideoCreditModelIdentifier(
              o.value,
              duration,
              sound,
              "image-to-video",
            ),
          )
        }
      }
    }
  })

  // The regression this design exists to prevent: the Seedance 2 family has NO
  // declared billing default but its provider RENDERS 720p when the field is
  // omitted — a first-option (480p) default would silently downgrade every
  // default run. It must start on Auto instead.
  it("an undeclared-default model (seedance-2) starts on Auto, never its first option", () => {
    expect(defaultVideoResolution("seedance-2")).toBeUndefined()
    const lever = leverOf("seedance-2")
    expect(lever.initial).toBe(DIRECTING_RESOLUTION_AUTO)
    expect(lever.options[0]).toEqual({
      value: DIRECTING_RESOLUTION_AUTO,
      label: "Auto",
    })
  })

  // The platform's declared default is honored where it exists (Seedance 2.5 →
  // 720p, NOT its cheaper first option 480p, and no redundant Auto row) — and a
  // non-default pick moves the identifier, so the quote tracks the lever.
  it("honors the declared billing default and re-prices a non-default pick", () => {
    const lever = leverOf("seedance-2-5")
    expect(lever.initial).toBe("720p")
    expect(
      lever.options.some((o) => o.value === DIRECTING_RESOLUTION_AUTO),
    ).toBe(false)
    const at = (res: string) =>
      buildVideoCreditModelIdentifier(
        "seedance-2",
        8,
        true,
        "image-to-video",
        undefined,
        res,
      )
    expect(at("1080p")).not.toBe(at("480p"))
  })

  // A model with no catalog resolutions gets an EMPTY lever — the control hides
  // and nothing is ever sent (derived exemplar; skips if the catalog gains
  // resolutions for every model).
  it("a model without resolution options gets an empty lever", () => {
    const bare = VIDEO_MODEL_OPTIONS.find(
      (o) =>
        (videoModelOptions().find((m) => m.id === o.value)?.resolutions ?? [])
          .length === 0,
    )
    if (!bare) return
    const lever = leverOf(bare.value)
    expect(lever.options).toEqual([])
    expect(lever.initial).toBe(DIRECTING_RESOLUTION_AUTO)
  })
})

describe("model menu — video reference inputs (multi-type)", () => {
  // References are gated on the catalog's PER-TYPE caps
  // (VIDEO_REF_LIMITS_BY_PROVIDER) — ANY non-zero type counts — never a
  // feature-flag approximation.
  it("gates references on any non-zero per-type cap", () => {
    const hasCaps = (id: string) => {
      const { images, videos, audio } = videoReferenceLimits(id)
      return images > 0 || videos > 0 || audio > 0
    }
    // The contract holds for EVERY directing model — supported IFF some per-type
    // cap is non-zero — so no single model's caps can silently break the gate
    // (e.g. grok-i2v gaining image references, which the old pinned ids missed).
    for (const { value } of VIDEO_MODEL_OPTIONS) {
      expect(videoReferenceSupported(value)).toBe(hasCaps(value))
    }
    // Concrete anchors, DERIVED (not pinned): a model with caps → true, one without → false.
    const withRefs = VIDEO_MODEL_OPTIONS.find((o) => hasCaps(o.value))
    const withoutRefs = VIDEO_MODEL_OPTIONS.find((o) => !hasCaps(o.value))
    expect(withRefs).toBeDefined()
    expect(withoutRefs).toBeDefined()
    expect(videoReferenceSupported(withRefs!.value)).toBe(true)
    expect(videoReferenceSupported(withoutRefs!.value)).toBe(false)
  })

  // The per-type caps come STRAIGHT from the catalog map (image · video · audio).
  it("derives per-type caps from the catalog", () => {
    expect(videoReferenceLimits("seedance-2")).toEqual({
      images: 9,
      videos: 3,
      audio: 3,
    })
    expect(videoReferenceLimits("gemini-omni-video")).toEqual({
      images: 7,
      videos: 1,
      audio: 0,
    })
    // A non-reference model has zero caps for every type.
    expect(videoReferenceLimits("kling-3.0")).toEqual({
      images: 0,
      videos: 0,
      audio: 0,
    })
  })

  // videoReferenceCap is the image-count convenience over the full limits.
  it("exposes the image cap as a convenience", () => {
    expect(videoReferenceCap("seedance-2")).toBe(9)
    expect(videoReferenceCap("kling-3.0")).toBe(0)
  })
})

describe("model menu — Framing image models (full menu, prompt-only included)", () => {
  // The Framing picker lists the WHOLE curated image menu, in menu order —
  // prompt-only (no-reference) models included (user decision 2026-08-18,
  // admitting Grok Imagine 2 / the Imagen tier; the old reference-capable
  // filter is gone — the picker shows a "Prompt only" tile and the composer's
  // per-model gates keep the reference affordances inert).
  it("mirrors the full image menu, in order", () => {
    expect(FRAMING_IMAGE_MODEL_OPTIONS.map((o) => o.value)).toEqual(
      IMAGE_MODEL_OPTIONS.map((o) => o.value),
    )
  })

  // Every row carries the model's real cap, wired straight from the shared
  // helper — so the picker's "N images" / "Prompt only" can't drift from the
  // catalog.
  it("carries each model's reference-image cap from imageReferenceLimit", () => {
    expect(FRAMING_IMAGE_MODEL_OPTIONS.length).toBeGreaterThan(0)
    expect(
      FRAMING_IMAGE_MODEL_OPTIONS.every(
        (o) => o.referenceImages === imageReferenceLimit(o.value),
      ),
    ).toBe(true)
  })

  // Both capability shapes are really present: Grok Imagine 2 (the low-cap
  // model this widening shipped for — prompt-only at cap 0 until
  // @nodaro/shared 2.11.0, where the catalog gave it ONE reference image via
  // the segment-map → image-edit chain) and the reference-capable default
  // (gpt-image-2), which must still sit strictly above it.
  it("includes grok-2 as a low-cap row and keeps reference-capable rows", () => {
    const grok2 = FRAMING_IMAGE_MODEL_OPTIONS.find((o) => o.value === "grok-2")
    expect(grok2).toBeDefined()
    expect(grok2?.referenceImages).toBe(1)
    const def = FRAMING_IMAGE_MODEL_OPTIONS.find(
      (o) => o.value === DEFAULT_FRAMING_PROVIDER,
    )
    expect(def).toBeDefined()
    expect((def?.referenceImages ?? 0) > (grok2?.referenceImages ?? 0)).toBe(true)
  })
})

describe("model menu — emotion-video default", () => {
  // The Emotion-videos generator defaults to Seedance 2.0 Fast. Pin it so a
  // catalog/allowlist change can't silently fall the default back to the
  // directing default (the resolver degrades gracefully if `seedance-2-fast`
  // ever leaves the menu — this guards that it currently doesn't).
  it("defaults to Seedance 2.0 Fast (seedance-2-fast)", () => {
    expect(EMOTION_VIDEO_DEFAULT_PROVIDER).toBe("seedance-2-fast")
  })

  it("is a real, selectable option in the emotion menu", () => {
    expect(
      EMOTION_VIDEO_MODEL_OPTIONS.some(
        (o) => o.value === EMOTION_VIDEO_DEFAULT_PROVIDER,
      ),
    ).toBe(true)
  })

  // Emotion clips are talking/performance — the default should accept audio
  // references (the optional audio strip is gated on a non-zero audio cap).
  it("accepts audio references (so the optional audio strip can show)", () => {
    expect(videoReferenceLimits("seedance-2-fast").audio).toBeGreaterThan(0)
  })

  // The emotion menu carries only IDENTITY-CAPABLE models — image references or
  // at least a start frame (the two anchors the generator's submit resolves). A
  // text-only model would render a generic person, so it's filtered out; every
  // survivor must satisfy the anchor invariant.
  it("filters the menu to identity-capable models (refs or start frame)", () => {
    expect(EMOTION_VIDEO_MODEL_OPTIONS.length).toBeGreaterThan(0)
    for (const { value } of EMOTION_VIDEO_MODEL_OPTIONS) {
      expect(
        videoReferenceLimits(value).images > 0 ||
          videoSupportsStartFrame(value),
        value,
      ).toBe(true)
    }
    const textOnly = VIDEO_MODEL_OPTIONS.find(
      (o) =>
        !videoSupportsStartFrame(o.value) &&
        videoReferenceLimits(o.value).images === 0,
    )
    expect(textOnly).toBeDefined()
    expect(
      EMOTION_VIDEO_MODEL_OPTIONS.some((o) => o.value === textOnly!.value),
    ).toBe(false)
  })
})

describe("model menu — Composer framing/directing defaults", () => {
  // The requested Composer defaults (product): Framing = GPT Image 2 · 2K · 16:9;
  // Directing = Seedance 2.5 · 16:9. Pin the ids/levers AND assert the chosen
  // models actually OFFER those levers — `useStaleSafeLever` only applies the
  // preferred default when the model exposes it (else it snaps to the model's
  // first option), so an offered-or-not catalog shift would silently change the
  // effective default.
  it("framing defaults to GPT Image 2 — a selectable image model", () => {
    expect(DEFAULT_FRAMING_PROVIDER).toBe("gpt-image-2")
    expect(
      IMAGE_MODEL_OPTIONS.some((o) => o.value === DEFAULT_FRAMING_PROVIDER),
    ).toBe(true)
    // Scoped: it must NOT move the shared entity-creation default.
    expect(DEFAULT_FRAMING_PROVIDER).not.toBe(DEFAULT_IMAGE_PROVIDER)
  })

  it("directing defaults to Seedance 2.5 — a selectable video model", () => {
    expect(DEFAULT_VIDEO_PROVIDER).toBe("seedance-2-5")
    expect(
      VIDEO_MODEL_OPTIONS.some((o) => o.value === DEFAULT_VIDEO_PROVIDER),
    ).toBe(true)
  })

  it("curated lever defaults are 2K · 16:9 (framing) and 16:9 (directing)", () => {
    expect(DEFAULT_FRAMING_RESOLUTION).toBe("2K")
    expect(DEFAULT_FRAMING_ASPECT).toBe("16:9")
    expect(DEFAULT_DIRECTING_ASPECT).toBe("16:9")
  })

  it("GPT Image 2 offers the 2K + 16:9 levers, so the framing defaults apply", () => {
    const m = imageModelOptions().find((o) => o.id === DEFAULT_FRAMING_PROVIDER)
    expect(m?.resolutions?.some((r) => r.value === DEFAULT_FRAMING_RESOLUTION)).toBe(
      true,
    )
    expect(m?.aspectRatios?.some((a) => a.value === DEFAULT_FRAMING_ASPECT)).toBe(
      true,
    )
  })

  it("Seedance 2.5 offers the 16:9 lever, so the directing default applies", () => {
    const m = videoModelOptions().find((o) => o.id === DEFAULT_VIDEO_PROVIDER)
    expect(
      m?.aspectRatios?.some((a) => a.value === DEFAULT_DIRECTING_ASPECT),
    ).toBe(true)
  })
})

describe("model menu — seedance-2-5 (catalog contract)", () => {
  // Guards the curated Directing default's real catalog capabilities
  // (@nodaro/shared ≥ 2.2.0 — the 2026-08-08 lag shim is gone): a platform
  // catalog change that would break the default (durations, caps, modes,
  // pricing identifiers) fails HERE, not in production.
  const ID = "seedance-2-5"

  it("is a selectable video model, ahead of Seedance 2 in the menu", () => {
    const ids = VIDEO_MODEL_OPTIONS.map((o) => o.value)
    expect(ids).toContain(ID)
    expect(ids.indexOf(ID)).toBeLessThan(ids.indexOf("seedance-2"))
    expect(VIDEO_MODEL_OPTIONS.find((o) => o.value === ID)?.label).toBe(
      "Seedance 2.5",
    )
  })

  it("offers every clip length from 4s up to 30s", () => {
    const durations = videoDurationOptions(ID).map((o) => o.value)
    expect(durations[0]).toBe(4)
    expect(durations[durations.length - 1]).toBe(30)
    expect(durations).toHaveLength(27) // 4..30 inclusive, every second
  })

  it("offers the 480p/720p/1080p tiers (1080p landed platform-side, shared@2.7.0)", () => {
    const m = videoModelOptions().find((o) => o.id === ID)
    const values = m?.resolutions?.map((r) => r.value) ?? []
    expect(values).toEqual(["480p", "720p", "1080p"])
    // The billing default stays 720p — the resolution lever keeps pre-selecting
    // it (price-neutral); 1080p is an explicit, re-priced pick.
    expect(defaultVideoResolution(ID)).toBe("720p")
  })

  it("supports all three directing modes, curated to References", () => {
    expect(videoSupportsStartFrame(ID)).toBe(true)
    expect(videoSupportsEndFrame(ID)).toBe(true)
    expect(videoReferenceSupported(ID)).toBe(true)
    expect(defaultDirectingModeFor(ID)).toBe("references")
  })

  it("carries the widened 30/10/10 multimodal reference caps", () => {
    expect(videoReferenceLimits(ID)).toEqual({
      images: 30,
      videos: 10,
      audio: 10,
    })
  })

  it("keeps the family's audio semantics (audio-driven, generateAudio field)", () => {
    expect(videoAudioField(ID)).toBe("generateAudio")
    expect(videoModelCanSpeakDialogue(ID)).toBe(true)
    // …and the family's no-native-negative-prompt stance.
    expect(negativePromptSupported("video", ID)).toBe(false)
  })

  // The cost preview must quote the tier the server actually bills. A
  // no-resolution call resolves to the model's REAL billing default — 720p via
  // the shared `PRICING_DEFAULT_RESOLUTION` (unlike the 2.0 SKUs' 480p);
  // billing is per-second, so every duration has its own tier; the `-ref`
  // discount applies to reference VIDEO runs.
  it("builds server-priced credit identifiers (720p default · per-second tiers · -ref)", () => {
    expect(buildVideoCreditModelIdentifier(ID, 8, undefined, "image-to-video")).toBe(
      "seedance-2-5:8s:720p",
    )
    expect(
      buildVideoCreditModelIdentifier(ID, 30, undefined, "image-to-video", undefined, "480p"),
    ).toBe("seedance-2-5:30s:480p")
    // Per-second duration tiers — a mid duration quotes ITS OWN tier.
    expect(
      buildVideoCreditModelIdentifier(ID, 12, undefined, "image-to-video"),
    ).toBe("seedance-2-5:12s:720p")
    expect(
      buildVideoCreditModelIdentifier(
        ID, 8, undefined, "image-to-video", undefined, undefined, true,
      ),
    ).toBe("seedance-2-5:8s:720p-ref")
  })
})

describe("model menu — prompt-only (text-to-video) capability", () => {
  // The "just describe the shot" Directing path: allowed exactly for models
  // whose catalog declares the t2v mode AND that aren't on the platform's own
  // image-required route guard — the same double gate the CTA/submit/hook use.
  it("the Directing default renders from a prompt alone", () => {
    expect(videoSupportsPromptOnly(DEFAULT_VIDEO_PROVIDER)).toBe(true)
  })

  it("derives from the catalog t2v mode minus the image-required guard", () => {
    const t2v = new Set(modelIdsByKindMode("video", ["t2v"]))
    for (const { value } of VIDEO_MODEL_OPTIONS) {
      expect(videoSupportsPromptOnly(value), value).toBe(
        t2v.has(value) && !videoProviderRequiresImage(value),
      )
    }
  })

  it("the menu still exercises the gated (i2v-only) case", () => {
    expect(
      VIDEO_MODEL_OPTIONS.some((o) => !videoSupportsPromptOnly(o.value)),
    ).toBe(true)
  })
})

describe("model menu — minimax-h3 (catalog contract)", () => {
  // Guards Hailuo 3's catalog capabilities the way the seedance-2-5 block
  // does: the model rides the fully data-driven menu (no studio shim — it
  // shipped IN @nodaro/shared@2.2.0), so a platform catalog change that would
  // break its row/levers/pricing fails HERE, not in production.
  const ID = "minimax-h3"

  it("is a selectable video model, surfaced in the curated lead block", () => {
    const ids = VIDEO_MODEL_OPTIONS.map((o) => o.value)
    expect(ids).toContain(ID)
    // Curation: after the Seedance pair, ahead of the catalog-order tail.
    expect(ids.indexOf(ID)).toBeGreaterThan(ids.indexOf("seedance-2"))
    expect(ids.indexOf(ID)).toBeLessThan(ids.indexOf("gemini-omni-video"))
    // Display-label override (app curation): the picker shows the wire id,
    // not the catalog's "Hailuo 3 (H3)" (user decision 2026-08-09).
    expect(VIDEO_MODEL_OPTIONS.find((o) => o.value === ID)?.label).toBe(
      "minimax-h3",
    )
  })

  it("offers 4–15s clips and the 2K-default / 768P resolutions", () => {
    const durations = videoDurationOptions(ID).map((o) => o.value)
    expect(durations[0]).toBe(4)
    expect(durations[durations.length - 1]).toBe(15)
    const m = videoModelOptions().find((o) => o.id === ID)
    expect(m?.resolutions?.map((r) => r.value)).toEqual(["2K", "768P"])
  })

  it("supports all three directing modes (first/last frame + references)", () => {
    expect(videoSupportsStartFrame(ID)).toBe(true)
    expect(videoSupportsEndFrame(ID)).toBe(true)
    expect(videoReferenceSupported(ID)).toBe(true)
    // No curated mode override — the positional fallback lands on start-end.
    expect(defaultDirectingModeFor(ID)).toBe("start-end")
  })

  it("carries the Seedance-2-class 9/3/3 multimodal reference caps", () => {
    expect(videoReferenceLimits(ID)).toEqual({ images: 9, videos: 3, audio: 3 })
  })

  it("has ALWAYS-ON audio (no toggle field) that can speak dialogue", () => {
    // `alwaysOn` audio ⇒ no wire toggle — the submit must NOT send `sound`.
    expect(videoAudioField(ID)).toBeUndefined()
    expect(videoModelCanSpeakDialogue(ID)).toBe(true)
    expect(negativePromptSupported("video", ID)).toBe(false)
  })

  // Pricing: plain `:Ns` identifiers ARE the 2K tier (the KIE default when no
  // resolution rides — studio's Directing has no video resolution lever), and
  // the cheaper 768P tier appends `:768p`. No `-ref` dimension for this model.
  it("builds server-priced credit identifiers (2K default · :768p tier)", () => {
    expect(buildVideoCreditModelIdentifier(ID, 6, undefined, "image-to-video")).toBe(
      "minimax-h3:6s",
    )
    expect(
      buildVideoCreditModelIdentifier(ID, 8, undefined, "image-to-video", undefined, "768P"),
    ).toBe("minimax-h3:8s:768p")
    expect(
      buildVideoCreditModelIdentifier(
        ID, 6, undefined, "image-to-video", undefined, undefined, true,
      ),
    ).toBe("minimax-h3:6s")
  })
})

describe("nearestDuration — storyboard seconds → directing clip length", () => {
  it("returns the exact segment length when the model offers it", () => {
    // Seedance 2 (the storyboard directing default) offers 4–15, so a 7s shot maps to 7.
    const opts = videoDurationOptions(STORYBOARD_DIRECTING_PROVIDER)
    expect(opts.some((o) => o.value === 7)).toBe(true)
    expect(nearestDuration(7, opts)).toBe(7)
  })

  it("snaps to the closest offered length when the exact one is unavailable", () => {
    const opts = [4, 5, 6, 7, 8].map((value) => ({ value }))
    expect(nearestDuration(2, opts)).toBe(4) // below the range → shortest
    expect(nearestDuration(100, opts)).toBe(8) // above → longest
  })

  it("breaks a tie toward the shorter (options are ascending)", () => {
    expect(nearestDuration(7, [{ value: 6 }, { value: 8 }])).toBe(6)
  })

  it("returns undefined when the model offers no durations", () => {
    expect(nearestDuration(7, [])).toBeUndefined()
  })
})

/**
 * The directing aspect lever is what a run sends as `aspectRatio` on EITHER
 * platform video lane. `/v1/generate-video` takes a wider set (it also accepts
 * `"Auto"`), but `/v1/text-to-video` validates against a closed zod enum and
 * answers 400 to anything outside it — so a catalog model whose menu offers an
 * aspect the t2v route doesn't know would break the prompt-only / references
 * lane for that model alone, silently, at submit.
 */
describe("model menu — every video aspect option is accepted by the text-to-video lane", () => {
  // Copied from `textToVideoBody` in the platform's
  // `backend/src/routes/text-to-video.ts` (read 2026-09-04). The route is the
  // authority; this list is the studio-side mirror a catalog change fails
  // against. NOTE the route's enum has NO `"Auto"` — the resolution lever is
  // where that word lives, and it is omitted when Auto.
  const TEXT_TO_VIDEO_ASPECT_ENUM = [
    "16:9",
    "9:16",
    "1:1",
    "4:3",
    "3:4",
    "4:5",
    "5:4",
    "21:9",
    "9:21",
    "adaptive",
  ]

  it("offers no aspect the route's enum would reject", () => {
    for (const model of videoModelOptions()) {
      for (const { value } of model.aspectRatios) {
        expect(TEXT_TO_VIDEO_ASPECT_ENUM, `${model.id} → ${value}`).toContain(
          value,
        )
      }
    }
  })

  it("actually exercises the menu (the guard is not vacuous)", () => {
    expect(
      videoModelOptions().some((m) => m.aspectRatios.length > 0),
    ).toBe(true)
  })
})

// Tal, 2026-09-06: "by default the studio is generating 1k images (character,
// locations, ...). better to use 2k as default". The entity creators sent no
// tier ("" = the model's own default, 1K on GPT Image 2 / Nano Banana Pro).
// The default is catalog-driven: 2K only where the model's resolution lever
// offers it; a megapixel or quality-tier model keeps its own default.
describe("model menu — default image quality for entity generation", () => {
  it("is the 2K tier for a model whose resolution lever offers it", () => {
    expect(DEFAULT_ENTITY_RESOLUTION).toBe("2K")
    expect(defaultImageQuality("gpt-image-2")).toBe("2K")
    expect(defaultImageQuality("nano-banana-pro")).toBe("2K")
  })

  it("stays the model default (empty) where 2K is not a tier, for quality-lever models, and for unknown ids", () => {
    expect(defaultImageQuality("flux-2-pro")).toBe("")
    expect(defaultImageQuality("seedream-5-lite")).toBe("")
    expect(defaultImageQuality("totally-not-a-real-model")).toBe("")
  })
})
