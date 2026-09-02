import {
  buildCreditModelIdentifier,
  resolveImageGenCreditIdentifier,
  resolveNormalizedImageGen,
  buildVideoCreditModelIdentifier,
  buildMotionCreditModelIdentifier,
} from "../credit-identifiers.js"

// ---------------------------------------------------------------------------
// buildCreditModelIdentifier
// ---------------------------------------------------------------------------
describe("buildCreditModelIdentifier", () => {
  // --- High-quality providers ---
  describe("high-quality providers", () => {
    const highQualityProviders = [
      "gpt-image",
      "gpt-image-i2i",
      "seedream",
      "seedream-edit",
      "seedream-5-lite",
      "seedream-5-lite-i2i",
      "seedream-5-pro",
      "seedream-5-pro-i2i",
    ]

    it.each(highQualityProviders)(
      '%s + quality="high" returns composite identifier',
      (provider) => {
        expect(buildCreditModelIdentifier(provider, "high")).toBe(`${provider}:high`)
      },
    )

    it.each(highQualityProviders)(
      '%s + quality="standard" returns base provider',
      (provider) => {
        expect(buildCreditModelIdentifier(provider, "standard")).toBe(provider)
      },
    )

    it('gpt-image with no quality returns base provider', () => {
      expect(buildCreditModelIdentifier("gpt-image")).toBe("gpt-image")
    })
  })

  // --- 2K resolution providers ---
  describe("2K resolution providers", () => {
    const twoKProviders = ["flux", "flux-pro-i2i", "flux-flex", "flux-i2i"]

    it.each(twoKProviders)(
      '%s + resolution="2K" returns composite identifier',
      (provider) => {
        expect(buildCreditModelIdentifier(provider, undefined, "2K")).toBe(`${provider}:2K`)
      },
    )

    it.each(twoKProviders)(
      '%s + resolution="1K" returns base provider',
      (provider) => {
        expect(buildCreditModelIdentifier(provider, undefined, "1K")).toBe(provider)
      },
    )

    it("flux with no resolution returns base provider", () => {
      expect(buildCreditModelIdentifier("flux")).toBe("flux")
    })
  })

  // --- nano-banana-pro 4K ---
  describe("nano-banana-pro", () => {
    it('resolution="4K" returns composite identifier', () => {
      expect(buildCreditModelIdentifier("nano-banana-pro", undefined, "4K")).toBe(
        "nano-banana-pro:4K",
      )
    })

    it('resolution="2K" returns base provider (only 4K triggers composite)', () => {
      expect(buildCreditModelIdentifier("nano-banana-pro", undefined, "2K")).toBe(
        "nano-banana-pro",
      )
    })

    it('resolution="1K" returns base provider', () => {
      expect(buildCreditModelIdentifier("nano-banana-pro", undefined, "1K")).toBe(
        "nano-banana-pro",
      )
    })
  })

  // --- nano-banana-2 ---
  describe("nano-banana-2", () => {
    it('resolution="2K" returns composite identifier', () => {
      expect(buildCreditModelIdentifier("nano-banana-2", undefined, "2K")).toBe(
        "nano-banana-2:2K",
      )
    })

    it('resolution="4K" returns composite identifier', () => {
      expect(buildCreditModelIdentifier("nano-banana-2", undefined, "4K")).toBe(
        "nano-banana-2:4K",
      )
    })

    it('resolution="1K" returns base provider', () => {
      expect(buildCreditModelIdentifier("nano-banana-2", undefined, "1K")).toBe("nano-banana-2")
    })
  })

  // --- topaz-image-upscale ---
  describe("topaz-image-upscale", () => {
    it('targetResolution="4K" returns composite identifier', () => {
      expect(
        buildCreditModelIdentifier("topaz-image-upscale", undefined, undefined, undefined, "4K"),
      ).toBe("topaz-image-upscale:4K")
    })

    it('targetResolution="8K" returns composite identifier', () => {
      expect(
        buildCreditModelIdentifier("topaz-image-upscale", undefined, undefined, undefined, "8K"),
      ).toBe("topaz-image-upscale:8K")
    })

    it('targetResolution="2K" returns base provider (2K is default)', () => {
      expect(
        buildCreditModelIdentifier("topaz-image-upscale", undefined, undefined, undefined, "2K"),
      ).toBe("topaz-image-upscale")
    })

    it("no targetResolution returns base provider", () => {
      expect(buildCreditModelIdentifier("topaz-image-upscale")).toBe("topaz-image-upscale")
    })
  })

  // --- Ideogram providers ---
  describe("ideogram providers", () => {
    const ideogramProviders = ["ideogram-edit", "ideogram-remix", "ideogram-reframe", "ideogram-v3"]

    it.each(ideogramProviders)(
      '%s + renderingSpeed="TURBO" returns composite identifier',
      (provider) => {
        expect(buildCreditModelIdentifier(provider, undefined, undefined, "TURBO")).toBe(
          `${provider}:TURBO`,
        )
      },
    )

    it.each(ideogramProviders)(
      '%s + renderingSpeed="QUALITY" returns composite identifier',
      (provider) => {
        expect(buildCreditModelIdentifier(provider, undefined, undefined, "QUALITY")).toBe(
          `${provider}:QUALITY`,
        )
      },
    )

    it.each(ideogramProviders)(
      '%s + renderingSpeed="BALANCED" returns base provider',
      (provider) => {
        expect(buildCreditModelIdentifier(provider, undefined, undefined, "BALANCED")).toBe(
          provider,
        )
      },
    )

    it("ideogram-v3 with no renderingSpeed returns base provider", () => {
      expect(buildCreditModelIdentifier("ideogram-v3")).toBe("ideogram-v3")
    })
  })

  // --- Fallback / unknown ---
  describe("fallback behavior", () => {
    it("unknown provider returns plain provider string", () => {
      expect(buildCreditModelIdentifier("some-unknown-model")).toBe("some-unknown-model")
    })

    it("no optional params returns plain provider string", () => {
      expect(buildCreditModelIdentifier("minimax")).toBe("minimax")
    })

    it("irrelevant params on unknown provider are ignored", () => {
      expect(buildCreditModelIdentifier("unknown", "high", "4K", "TURBO", "8K")).toBe("unknown")
    })
  })

  // --- Flux 2 family — per-megapixel pricing ---
  describe("flux-2 family (per-megapixel identifiers)", () => {
    // All flux-2 models: <provider>:<mp>MP:<n>ref — the ref count is always
    // encoded because every model charges per input MP, so Pro/Klein are
    // ref-aware too (not just Max).
    it("flux-2-pro with 2 MP resolution + 0 refs returns flux-2-pro:2MP:0ref", () => {
      expect(buildCreditModelIdentifier("flux-2-pro", undefined, "2 MP")).toBe("flux-2-pro:2MP:0ref")
    })

    it("flux-2-pro with 2 MP + 1 ref returns flux-2-pro:2MP:1ref", () => {
      expect(buildCreditModelIdentifier("flux-2-pro", undefined, "2 MP", undefined, undefined, 1)).toBe("flux-2-pro:2MP:1ref")
    })

    it("flux-2-klein with 1 MP resolution returns flux-2-klein:1MP:0ref", () => {
      expect(buildCreditModelIdentifier("flux-2-klein", undefined, "1 MP")).toBe("flux-2-klein:1MP:0ref")
    })

    it("flux-2-pro with no resolution defaults to 1MP, ref-aware", () => {
      expect(buildCreditModelIdentifier("flux-2-pro", undefined, undefined, undefined, undefined, 4)).toBe("flux-2-pro:1MP:4ref")
    })

    // flux-2-max: <provider>:<mp>MP:<n>ref (always includes ref count)
    it("flux-2-max with 2 MP and 1 ref returns flux-2-max:2MP:1ref", () => {
      expect(buildCreditModelIdentifier("flux-2-max", undefined, "2 MP", undefined, undefined, 1)).toBe("flux-2-max:2MP:1ref")
    })

    it("flux-2-max with 2 MP and 0 refs returns flux-2-max:2MP:0ref", () => {
      expect(buildCreditModelIdentifier("flux-2-max", undefined, "2 MP", undefined, undefined, 0)).toBe("flux-2-max:2MP:0ref")
    })

    it("flux-2-max with no resolution defaults to 1MP", () => {
      expect(buildCreditModelIdentifier("flux-2-max", undefined, undefined, undefined, undefined, 0)).toBe("flux-2-max:1MP:0ref")
    })

    it.each([1, 2, 3, 4, 5, 6, 7, 8])("flux-2-max 1MP %i refs returns composite identifier", (n) => {
      expect(buildCreditModelIdentifier("flux-2-max", undefined, "1 MP", undefined, undefined, n)).toBe(`flux-2-max:1MP:${n}ref`)
    })

    it("flux-2-max caps ref count at 8", () => {
      expect(buildCreditModelIdentifier("flux-2-max", undefined, "2 MP", undefined, undefined, 12)).toBe("flux-2-max:2MP:8ref")
    })

    it("flux-2-max strips MP unit correctly (no trailing space)", () => {
      expect(buildCreditModelIdentifier("flux-2-max", undefined, "4 MP", undefined, undefined, 0)).toBe("flux-2-max:4MP:0ref")
    })

    it("does not affect non-flux-2 providers", () => {
      expect(buildCreditModelIdentifier("nano-banana", undefined, undefined, undefined, undefined, 4)).toBe("nano-banana")
    })
  })
})

// ---------------------------------------------------------------------------
// buildVideoCreditModelIdentifier
// ---------------------------------------------------------------------------
describe("buildVideoCreditModelIdentifier", () => {
  // --- LTX 2.3 resolution×duration composites (regression: a bare-id reserve
  //     undercharged 2k/4k/long runs up to ~6.6x because commit can't collect
  //     an upward delta). Every emitted id MUST be a seeded composite. ---
  describe("LTX 2.3 resolution×duration pricing", () => {
    const sig = (p: string, res?: string, dur?: number) =>
      buildVideoCreditModelIdentifier(p, dur, false, "image-to-video", undefined, res, false)

    it("emits the resolution×duration composite (not the bare cheapest tier)", () => {
      expect(sig("ltx-2.3-pro", "4k", 10)).toBe("ltx-2.3-pro:4k:10s")
      expect(sig("ltx-2.3-pro", "2k", 8)).toBe("ltx-2.3-pro:2k:8s")
      expect(sig("ltx-2.3-fast", "1080p", 20)).toBe("ltx-2.3-fast:1080p:20s")
    })

    it("defaults to the cheapest seeded tier when res/duration are absent", () => {
      expect(sig("ltx-2.3-pro")).toBe("ltx-2.3-pro:1080p:6s")
      expect(sig("ltx-2.3-fast")).toBe("ltx-2.3-fast:1080p:6s")
    })

    it("snaps off-catalog inputs to a SEEDED tier (no price_not_configured 503)", () => {
      // fast 2k/4k only seed up to 10s; an 18s 4k request must snap to 4k:10s
      expect(sig("ltx-2.3-fast", "4k", 18)).toBe("ltx-2.3-fast:4k:10s")
      // off-tier duration snaps to nearest; unknown band defaults to 1080p
      expect(sig("ltx-2.3-pro", "4k", 7)).toBe("ltx-2.3-pro:4k:6s")
      expect(sig("ltx-2.3-pro", "8k", 8)).toBe("ltx-2.3-pro:1080p:8s")
    })
  })

  // --- Metered-reserve invariant (commit_credits cannot collect an upward
  //     delta — migration 176 only refunds a surplus). So any video provider
  //     finalized with meteredCost:true MUST reserve a CONFIG-SCALED ceiling:
  //     for a high-res / long-duration config its credit id must NOT be the bare
  //     provider id, or the run under-bills (the LTX ~6.6x regression). A new
  //     metered video provider added without a resolution/duration pricing tier
  //     fails this — add it to the pricing sets (and to this list). ---
  describe("metered video providers reserve a config-scaled ceiling", () => {
    const METERED_VIDEO_PROVIDERS = ["ltx-2.3-pro", "ltx-2.3-fast"]
    it.each(METERED_VIDEO_PROVIDERS)(
      "%s: a 4k/10s config does NOT reserve the bare provider id",
      (provider) => {
        const id = buildVideoCreditModelIdentifier(provider, 10, false, "image-to-video", undefined, "4k", false)
        expect(id).not.toBe(provider)
        expect(id).toContain(":")
      },
    )
  })

  // --- Non-duration-priced providers ---
  describe("non-duration-priced providers", () => {
    it("minimax returns plain provider", () => {
      expect(buildVideoCreditModelIdentifier("minimax")).toBe("minimax")
    })

    it("veo3 returns plain provider", () => {
      expect(buildVideoCreditModelIdentifier("veo3", 10)).toBe("veo3")
    })

    it("VEO 4K → :4k composite for all three tiers (incl. Quality)", () => {
      // resolution is the 6th positional arg (provider, duration, sound, nodeType, mode, resolution)
      expect(buildVideoCreditModelIdentifier("veo3", 8, undefined, undefined, undefined, "4k")).toBe("veo3:4k")
      expect(buildVideoCreditModelIdentifier("veo3.1", 8, undefined, undefined, undefined, "4k")).toBe("veo3.1:4k")
      expect(buildVideoCreditModelIdentifier("veo3_lite", 8, undefined, undefined, undefined, "4k")).toBe("veo3_lite:4k")
    })

    it("VEO keeps 720p base / 1080p tier behavior alongside 4k", () => {
      expect(buildVideoCreditModelIdentifier("veo3.1", 8, undefined, undefined, undefined, "1080p")).toBe("veo3.1:1080p")
      expect(buildVideoCreditModelIdentifier("veo3.1", 8, undefined, undefined, undefined, "720p")).toBe("veo3.1")
      // Quality has no 1080p tier in our table → 720p/1080p both map to base, but 4k is distinct
      expect(buildVideoCreditModelIdentifier("veo3", 8, undefined, undefined, undefined, "1080p")).toBe("veo3")
    })

    it("runway-kie returns plain provider", () => {
      expect(buildVideoCreditModelIdentifier("runway-kie", 5)).toBe("runway-kie")
    })
  })

  // --- Duration tiers for kling-3.0 ---
  describe("kling-3.0 duration tiers", () => {
    it("5s duration returns :5s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 5, false)).toBe("kling-3.0:5s")
    })

    it("3s duration falls into 5s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 3, false)).toBe("kling-3.0:5s")
    })

    it("10s duration returns :10s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 10, false)).toBe("kling-3.0:10s")
    })

    it("7s duration falls into 10s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 7, false)).toBe("kling-3.0:10s")
    })

    it("15s duration returns :15s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 15, false)).toBe("kling-3.0:15s")
    })

    it("duration exceeding max tier clamps to last tier (20s -> 15s)", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 20, false)).toBe("kling-3.0:15s")
    })

    it("duration exceeding max tier clamps to last tier (100s -> 15s)", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 100, false)).toBe("kling-3.0:15s")
    })
  })

  // --- Audio addon ---
  describe("audio addon", () => {
    it("kling-3.0 + sound=true appends :audio", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 5, true)).toBe("kling-3.0:5s:audio")
    })

    it("kling + sound=true appends :audio", () => {
      expect(buildVideoCreditModelIdentifier("kling", 5, true)).toBe("kling:5s:audio")
    })

    it("kling-3.0 + sound UNDEFINED appends :audio (model default is audio ON)", () => {
      // The provider layer generates audio when the caller expressed no intent
      // (models.ts extraParams.sound: true + kling3-client `?? true`). Billing
      // must mirror that via capability defaultOn — reserving the no-audio
      // tier against an audio-on generation was a silent under-bill.
      expect(buildVideoCreditModelIdentifier("kling-3.0", 5, undefined)).toBe("kling-3.0:5s:audio")
    })

    it("kling (2.6) + sound UNDEFINED does not append :audio (model default is OFF)", () => {
      expect(buildVideoCreditModelIdentifier("kling", 5, undefined)).toBe("kling:5s")
    })

    it("kling-3.0 + sound=false does not append :audio", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 5, false)).toBe("kling-3.0:5s")
    })

    it("non-audio provider + sound=true does not append :audio", () => {
      expect(buildVideoCreditModelIdentifier("minimax", 5, true)).toBe("minimax")
    })
  })

  // --- Mode addon ---
  describe("mode addon", () => {
    it("non-mode provider ignores mode param", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 5, false, undefined, "high")).toBe(
        "kling-3.0:5s",
      )
    })
  })

  // --- T2V credit overrides ---
  describe("T2V credit overrides", () => {
    it('grok + text-to-video returns "grok-i2v" (override target has duration pricing)', () => {
      expect(buildVideoCreditModelIdentifier("grok", 6, false, "text-to-video")).toBe(
        "grok-i2v:6s",
      )
    })

    it("grok + text-to-video respects duration tiers of grok-i2v", () => {
      expect(buildVideoCreditModelIdentifier("grok", 10, false, "text-to-video")).toBe(
        "grok-i2v:10s",
      )
    })

    it('wan + text-to-video returns "wan-t2v" (override target has no duration pricing)', () => {
      expect(buildVideoCreditModelIdentifier("wan", 10, false, "text-to-video")).toBe("wan-t2v")
    })

    it('wan-turbo + text-to-video returns "wan-turbo-t2v"', () => {
      expect(buildVideoCreditModelIdentifier("wan-turbo", 10, false, "text-to-video")).toBe(
        "wan-turbo-t2v",
      )
    })

    it("grok + image-to-video does NOT apply T2V override (grok is not duration-priced)", () => {
      expect(buildVideoCreditModelIdentifier("grok", 6, false, "image-to-video")).toBe("grok")
    })

    it("provider without T2V override + text-to-video behaves normally", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 5, false, "text-to-video")).toBe(
        "kling-3.0:5s",
      )
    })
  })

  // --- String duration parsing ---
  describe("duration parsing", () => {
    it('string duration "10" is parsed as number 10', () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", "10", false)).toBe("kling-3.0:10s")
    })

    it('string duration "5" works', () => {
      expect(buildVideoCreditModelIdentifier("kling", "5")).toBe("kling:5s")
    })

    it("NaN duration defaults to 5", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", "abc", false)).toBe("kling-3.0:5s")
    })

    it("undefined duration defaults to 5", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", undefined, false)).toBe("kling-3.0:5s")
    })

    it("0 duration falls into first tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 0, false)).toBe("kling-3.0:5s")
    })

    it("1 duration falls into first tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 1, false)).toBe("kling-3.0:5s")
    })
  })

  // --- seedance tiers ---
  describe("seedance duration tiers", () => {
    it("4s -> :4s", () => {
      expect(buildVideoCreditModelIdentifier("seedance", 4)).toBe("seedance:4s")
    })

    it("2s falls into 4s tier", () => {
      expect(buildVideoCreditModelIdentifier("seedance", 2)).toBe("seedance:4s")
    })

    it("8s -> :8s", () => {
      expect(buildVideoCreditModelIdentifier("seedance", 8)).toBe("seedance:8s")
    })

    it("6s falls into 8s tier", () => {
      expect(buildVideoCreditModelIdentifier("seedance", 6)).toBe("seedance:8s")
    })

    it("12s -> :12s", () => {
      expect(buildVideoCreditModelIdentifier("seedance", 12)).toBe("seedance:12s")
    })

    it("10s falls into 12s tier", () => {
      expect(buildVideoCreditModelIdentifier("seedance", 10)).toBe("seedance:12s")
    })

    it("exceeding max clamps to 12s", () => {
      expect(buildVideoCreditModelIdentifier("seedance", 20)).toBe("seedance:12s")
    })
  })

  // --- Other duration-priced providers ---
  describe("other duration-priced providers", () => {
    it("kling 5s", () => {
      expect(buildVideoCreditModelIdentifier("kling", 5)).toBe("kling:5s")
    })

    it("kling 10s", () => {
      expect(buildVideoCreditModelIdentifier("kling", 10)).toBe("kling:10s")
    })

    it("kling-turbo 5s", () => {
      expect(buildVideoCreditModelIdentifier("kling-turbo", 5)).toBe("kling-turbo:5s")
    })

    it("hailuo-2.3-pro 6s", () => {
      expect(buildVideoCreditModelIdentifier("hailuo-2.3-pro", 6)).toBe("hailuo-2.3-pro:6s")
    })

    it("hailuo-2.3-pro 3s falls into 6s tier", () => {
      expect(buildVideoCreditModelIdentifier("hailuo-2.3-pro", 3)).toBe("hailuo-2.3-pro:6s")
    })

    it("hailuo-standard 10s", () => {
      expect(buildVideoCreditModelIdentifier("hailuo-standard", 10)).toBe("hailuo-standard:10s")
    })

    it("wan-i2v 15s", () => {
      expect(buildVideoCreditModelIdentifier("wan-i2v", 15)).toBe("wan-i2v:15s")
    })

    it("grok-i2v 6s", () => {
      expect(buildVideoCreditModelIdentifier("grok-i2v", 6)).toBe("grok-i2v:6s")
    })

    it("grok-i2v 15s", () => {
      expect(buildVideoCreditModelIdentifier("grok-i2v", 15)).toBe("grok-i2v:15s")
    })
  })

  // --- Combined audio + duration edge case ---
  describe("combined suffixes", () => {
    it("kling-3.0 10s with audio", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 10, true)).toBe("kling-3.0:10s:audio")
    })

    it("kling 10s with audio", () => {
      expect(buildVideoCreditModelIdentifier("kling", 10, true)).toBe("kling:10s:audio")
    })

  })

  // --- Seedance 2 / 2-fast resolution × video-ref matrix ---
  describe("seedance-2 family (resolution + video-ref)", () => {
    describe("seedance-2 (no video ref)", () => {
      it("480p 4s -> :4s:480p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 4, false, undefined, undefined, "480p", false),
        ).toBe("seedance-2:4s:480p")
      })

      it("720p 8s -> :8s:720p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 8, false, undefined, undefined, "720p", false),
        ).toBe("seedance-2:8s:720p")
      })

      it("1080p 8s -> :8s:1080p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 8, false, undefined, undefined, "1080p", false),
        ).toBe("seedance-2:8s:1080p")
      })

      it("1080p 4s -> :4s:1080p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 4, false, undefined, undefined, "1080p", false),
        ).toBe("seedance-2:4s:1080p")
      })

      it("1080p 12s -> :12s:1080p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 12, false, undefined, undefined, "1080p", false),
        ).toBe("seedance-2:12s:1080p")
      })

      it("1080p 15s -> :15s:1080p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 15, false, undefined, undefined, "1080p", false),
        ).toBe("seedance-2:15s:1080p")
      })

      it("unknown resolution falls back to 480p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 8, false, undefined, undefined, "unknown", false),
        ).toBe("seedance-2:8s:480p")
      })

      it("undefined resolution defaults to 480p (back-compat)", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 8, false, undefined, undefined, undefined, false),
        ).toBe("seedance-2:8s:480p")
      })
    })

    describe("seedance-2 (with video ref)", () => {
      it("1080p 8s -> :8s:1080p-ref", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 8, false, undefined, undefined, "1080p", true),
        ).toBe("seedance-2:8s:1080p-ref")
      })

      it("720p 4s -> :4s:720p-ref", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 4, false, undefined, undefined, "720p", true),
        ).toBe("seedance-2:4s:720p-ref")
      })

      it("1080p 15s -> :15s:1080p-ref", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2", 15, false, undefined, undefined, "1080p", true),
        ).toBe("seedance-2:15s:1080p-ref")
      })
    })

    describe("seedance-2-fast (no 1080p SKU — stale 1080p clamps to 720p)", () => {
      it("1080p 8s no-ref clamps -> :8s:720p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2-fast", 8, false, undefined, undefined, "1080p", false),
        ).toBe("seedance-2-fast:8s:720p")
      })

      it("1080p 8s with ref clamps -> :8s:720p-ref", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2-fast", 8, false, undefined, undefined, "1080p", true),
        ).toBe("seedance-2-fast:8s:720p-ref")
      })

      it("1080p 12s no-ref clamps -> :12s:720p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2-fast", 12, false, undefined, undefined, "1080p", false),
        ).toBe("seedance-2-fast:12s:720p")
      })

      it("720p 8s no-ref -> :8s:720p (supported tier passes through)", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2-fast", 8, false, undefined, undefined, "720p", false),
        ).toBe("seedance-2-fast:8s:720p")
      })
    })
  })
})

// ---------------------------------------------------------------------------
// buildMotionCreditModelIdentifier
// ---------------------------------------------------------------------------
describe("buildMotionCreditModelIdentifier", () => {
  // --- Kling 3.0 ---
  describe("kling-3.0", () => {
    it("720p 10s returns kling-3.0-motion:10s (no resolution suffix for 720p)", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p", 10)).toBe(
        "kling-3.0-motion:10s",
      )
    })

    it("1080p 10s returns kling-3.0-motion:1080p:10s", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "1080p", 10)).toBe(
        "kling-3.0-motion:1080p:10s",
      )
    })

    it("720p 5s", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p", 5)).toBe(
        "kling-3.0-motion:5s",
      )
    })

    it("1080p 5s", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "1080p", 5)).toBe(
        "kling-3.0-motion:1080p:5s",
      )
    })

    it("720p 15s", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p", 15)).toBe(
        "kling-3.0-motion:15s",
      )
    })

    it("1080p 30s", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "1080p", 30)).toBe(
        "kling-3.0-motion:1080p:30s",
      )
    })
  })

  // --- Non-kling-3.0 providers (kling 2.6) ---
  describe("non-kling-3.0 providers", () => {
    it("kling 720p 10s returns motion-transfer:10s", () => {
      expect(buildMotionCreditModelIdentifier("kling", "720p", 10)).toBe("motion-transfer:10s")
    })

    it("kling 1080p 10s returns motion-transfer:1080p:10s", () => {
      expect(buildMotionCreditModelIdentifier("kling", "1080p", 10)).toBe(
        "motion-transfer:1080p:10s",
      )
    })

    it("kling 720p 5s", () => {
      expect(buildMotionCreditModelIdentifier("kling", "720p", 5)).toBe("motion-transfer:5s")
    })

    it("kling 1080p 30s", () => {
      expect(buildMotionCreditModelIdentifier("kling", "1080p", 30)).toBe(
        "motion-transfer:1080p:30s",
      )
    })
  })

  // --- Wan Animate Move ---
  describe("wan-animate-move", () => {
    it("480p returns base identifier (default resolution)", () => {
      expect(buildMotionCreditModelIdentifier("wan-animate-move", "480p")).toBe("wan-animate-move")
    })

    it("580p returns composite identifier", () => {
      expect(buildMotionCreditModelIdentifier("wan-animate-move", "580p")).toBe(
        "wan-animate-move:580p",
      )
    })

    it("720p returns composite identifier", () => {
      expect(buildMotionCreditModelIdentifier("wan-animate-move", "720p")).toBe(
        "wan-animate-move:720p",
      )
    })

    it("ignores videoDuration (resolution-based pricing only)", () => {
      expect(buildMotionCreditModelIdentifier("wan-animate-move", "580p", 30)).toBe(
        "wan-animate-move:580p",
      )
    })
  })

  // --- Wan Animate Replace ---
  describe("wan-animate-replace", () => {
    it("480p returns base identifier", () => {
      expect(buildMotionCreditModelIdentifier("wan-animate-replace", "480p")).toBe(
        "wan-animate-replace",
      )
    })

    it("580p returns composite identifier", () => {
      expect(buildMotionCreditModelIdentifier("wan-animate-replace", "580p")).toBe(
        "wan-animate-replace:580p",
      )
    })

    it("720p returns composite identifier", () => {
      expect(buildMotionCreditModelIdentifier("wan-animate-replace", "720p")).toBe(
        "wan-animate-replace:720p",
      )
    })
  })

  // --- Duration tier matching ---
  describe("duration tier matching", () => {
    it("3s falls into 5s tier", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p", 3)).toBe(
        "kling-3.0-motion:5s",
      )
    })

    it("7s falls into 10s tier", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p", 7)).toBe(
        "kling-3.0-motion:10s",
      )
    })

    it("12s falls into 15s tier", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p", 12)).toBe(
        "kling-3.0-motion:15s",
      )
    })

    it("25s falls into 30s tier", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p", 25)).toBe(
        "kling-3.0-motion:30s",
      )
    })

    it("exceeding max tier clamps to 30s", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p", 60)).toBe(
        "kling-3.0-motion:30s",
      )
    })
  })

  // --- Default duration ---
  describe("default duration", () => {
    it("no videoDuration defaults to 10 (falls into 10s tier)", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p")).toBe("kling-3.0-motion:10s")
    })

    it("no videoDuration for kling defaults to 10", () => {
      expect(buildMotionCreditModelIdentifier("kling", "720p")).toBe("motion-transfer:10s")
    })
  })

  // --- NaN handling ---
  describe("NaN handling", () => {
    it("NaN videoDuration defaults to 10", () => {
      expect(buildMotionCreditModelIdentifier("kling-3.0", "720p", NaN)).toBe(
        "kling-3.0-motion:10s",
      )
    })
  })
})

// ---------------------------------------------------------------------------
// gemini-omni-video credit identifier
// ---------------------------------------------------------------------------
describe("gemini-omni-video", () => {
  const id = (opts: { duration?: number | string; resolution?: string; hasVideoRef?: boolean; nodeType?: "image-to-video" | "text-to-video" }) =>
    buildVideoCreditModelIdentifier("gemini-omni-video", opts.duration, undefined, opts.nodeType ?? "image-to-video", undefined, opts.resolution, opts.hasVideoRef)

  it("prices 720p/1080p by duration tier", () => {
    expect(id({ duration: 4, resolution: "720p" })).toBe("gemini-omni-video:4")
    expect(id({ duration: 6, resolution: "1080p" })).toBe("gemini-omni-video:6")
    expect(id({ duration: 8, resolution: "720p" })).toBe("gemini-omni-video:8")
    expect(id({ duration: 10, resolution: "1080p" })).toBe("gemini-omni-video:10")
  })
  it("prices 4k by duration tier", () => {
    expect(id({ duration: 4, resolution: "4k" })).toBe("gemini-omni-video:4k:4")
    expect(id({ duration: 10, resolution: "4k" })).toBe("gemini-omni-video:4k:10")
  })
  it("prices V2V flat, ignoring duration", () => {
    expect(id({ duration: 8, resolution: "1080p", hasVideoRef: true })).toBe("gemini-omni-video:vref")
    expect(id({ duration: 8, resolution: "4k", hasVideoRef: true })).toBe("gemini-omni-video:4k:vref")
  })
  it("snaps off-tier durations to nearest allowed tier (never :5)", () => {
    expect(id({ duration: 5, resolution: "720p" })).toBe("gemini-omni-video:4")
    expect(id({ duration: 12, resolution: "720p" })).toBe("gemini-omni-video:10")
  })
  it("defaults to tier 8 when duration is undefined", () => {
    expect(id({ resolution: "720p" })).toBe("gemini-omni-video:8")
  })
  it("works on the text-to-video path too", () => {
    expect(id({ duration: 6, resolution: "720p", nodeType: "text-to-video" })).toBe("gemini-omni-video:6")
  })
})

// ---------------------------------------------------------------------------
// gemini-omni-flash credit identifier — the family branch reaches the sibling
// ---------------------------------------------------------------------------
// The Omni branch used to compare against the literal "gemini-omni-video" and
// hardcode that prefix in every returned string. It now asks
// isGeminiOmniProvider() and TEMPLATES the prefix, so this block is the proof
// that the refactor actually reaches the second SKU (the block above proves it
// stayed behaviour-neutral for the first). A flash run that fell through to the
// DURATION_PRICED gate would return the BARE id and reserve 270 credits for a
// 4K 10s render.
describe("gemini-omni-flash", () => {
  const id = (opts: { duration?: number | string; resolution?: string; hasVideoRef?: boolean; nodeType?: "image-to-video" | "text-to-video" }) =>
    buildVideoCreditModelIdentifier("gemini-omni-flash", opts.duration, undefined, opts.nodeType ?? "image-to-video", undefined, opts.resolution, opts.hasVideoRef)

  it("prices 720p/1080p by duration tier", () => {
    expect(id({ duration: 4, resolution: "720p" })).toBe("gemini-omni-flash:4")
    expect(id({ duration: 6, resolution: "1080p" })).toBe("gemini-omni-flash:6")
    expect(id({ duration: 8, resolution: "720p" })).toBe("gemini-omni-flash:8")
    expect(id({ duration: 10, resolution: "1080p" })).toBe("gemini-omni-flash:10")
  })
  it("prices 4k by duration tier", () => {
    expect(id({ duration: 4, resolution: "4k" })).toBe("gemini-omni-flash:4k:4")
    expect(id({ duration: 10, resolution: "4k" })).toBe("gemini-omni-flash:4k:10")
  })
  it("prices V2V flat, ignoring duration", () => {
    expect(id({ duration: 8, resolution: "1080p", hasVideoRef: true })).toBe("gemini-omni-flash:vref")
    expect(id({ duration: 8, resolution: "4k", hasVideoRef: true })).toBe("gemini-omni-flash:4k:vref")
  })
  it("snaps off-tier durations to nearest allowed tier (never :5)", () => {
    expect(id({ duration: 5, resolution: "720p" })).toBe("gemini-omni-flash:4")
    expect(id({ duration: 12, resolution: "720p" })).toBe("gemini-omni-flash:10")
  })
  it("defaults to tier 8 when duration is undefined", () => {
    expect(id({ resolution: "720p" })).toBe("gemini-omni-flash:8")
  })
  it("works on the text-to-video path too", () => {
    expect(id({ duration: 6, resolution: "720p", nodeType: "text-to-video" })).toBe("gemini-omni-flash:6")
  })
  it("never falls through to the bare id (the pre-refactor failure mode)", () => {
    for (const d of [undefined, 4, 6, 8, 10, 5, 12]) {
      for (const r of [undefined, "720p", "1080p", "4k"]) {
        expect(id({ duration: d, resolution: r })).not.toBe("gemini-omni-flash")
      }
    }
  })
})

// ---------------------------------------------------------------------------
// resolveNormalizedImageGen
// ---------------------------------------------------------------------------
describe("resolveNormalizedImageGen", () => {
  it("snaps an off-list aspect ratio and reports it", () => {
    const out = resolveNormalizedImageGen({
      provider: "gpt-image-2",
      aspectRatio: "3:2",
      resolution: "4K",
      refCount: 0,
      swapToI2i: true,
    })
    // 3:2 is not in GPT_IMAGE_2_RATIOS -> allowed[0] ("auto"), which then
    // cascades resolution to 1K via the model's cross-field rule.
    expect(out.aspectRatio).toBe("auto")
    expect(out.resolution).toBe("1K")
    expect(out.identifier).toBe("gpt-image-2")
    expect(out.adjustments.map((a) => a.field)).toEqual(["aspectRatio", "resolution"])
  })

  it("prices the SNAPPED resolution — gpt-image-2 auto + 2K reserves the 1K tier", () => {
    const out = resolveNormalizedImageGen({
      provider: "gpt-image-2",
      aspectRatio: "auto",
      resolution: "2K",
      refCount: 0,
      swapToI2i: true,
    })
    expect(out.resolution).toBe("1K")
    expect(out.identifier).toBe("gpt-image-2")
  })

  it("drops a lever the model does not have, and reports it", () => {
    const out = resolveNormalizedImageGen({
      provider: "recraft-upscale",
      aspectRatio: "16:9",
      refCount: 0,
    })
    expect(out.aspectRatio).toBeUndefined()
    expect(out.adjustments).toHaveLength(1)
    expect(out.adjustments[0].field).toBe("aspectRatio")
    expect(out.adjustments[0].to).toBeUndefined()
  })

  // grok-i2i deliberately has NO `aspectRatios` on its catalog entry, and that
  // is the HONEST declaration: KIE's grok-imagine/image-to-image schema accepts
  // only prompt / image_urls / nsfw_checker — there is no aspect_ratio param
  // (https://docs.kie.ai/market/grok-imagine/image-to-image.md). That is why
  // kie/models.ts gives it `extraParams: {}` while its t2i sibling gets
  // `{ aspect_ratio: "16:9" }`, and why kie/CLAUDE.md lists grok-i2i under
  // "No aspect ratio control". Declaring the t2i ratios here to "preserve" a
  // caller's value would put a lie in the catalog and keep forwarding a param
  // the endpoint ignores; dropping it and disclosing that via `adjustments` is
  // the correct behaviour. Do not "fix" this by adding GROK_RATIOS.
  it("drops the aspect ratio when grok auto-swaps to its ratio-less i2i sibling", () => {
    const out = resolveNormalizedImageGen({
      provider: "grok",
      aspectRatio: "16:9",
      refCount: 1,
      swapToI2i: true,
    })
    expect(out.modelId).toBe("grok-i2i")
    expect(out.aspectRatio).toBeUndefined()
    expect(out.adjustments).toHaveLength(1)
    expect(out.adjustments[0].field).toBe("aspectRatio")
    expect(out.adjustments[0].from).toBe("16:9")
    expect(out.adjustments[0].to).toBeUndefined()
    expect(out.identifier).toBe("grok-i2i")
  })

  it("snaps against the i2i variant when the T2I provider auto-swaps", () => {
    const out = resolveNormalizedImageGen({
      provider: "gpt-image-2",
      aspectRatio: "3:4",
      refCount: 2,
      swapToI2i: true,
    })
    expect(out.modelId).toBe("gpt-image-2-i2i")
    expect(out.aspectRatio).toBe("3:4")
    expect(out.adjustments).toEqual([])
  })

  it("coerces non-string levers to undefined (the preHandler runs pre-Zod)", () => {
    const out = resolveNormalizedImageGen({
      provider: "gpt-image-2",
      aspectRatio: 169,
      resolution: null,
      quality: {},
      refCount: 0,
    })
    expect(out.aspectRatio).toBeUndefined()
    expect(out.resolution).toBeUndefined()
    expect(out.quality).toBeUndefined()
    expect(out.adjustments).toEqual([])
    expect(out.identifier).toBe("gpt-image-2")
  })

  it("passes an unknown model id through untouched", () => {
    const out = resolveNormalizedImageGen({
      provider: "not-a-model",
      aspectRatio: "13:7",
      resolution: "9K",
      refCount: 0,
    })
    expect(out.aspectRatio).toBe("13:7")
    expect(out.resolution).toBe("9K")
    expect(out.adjustments).toEqual([])
    expect(out.identifier).toBe("not-a-model")
  })
})

// Regression pins: identifiers that are correct TODAY must be byte-identical
// once resolveImageGenCreditIdentifier delegates through the normalizer.
describe("resolveImageGenCreditIdentifier is unchanged for already-valid input", () => {
  it.each([
    [{ provider: "flux-2-max", refCount: 3, swapToI2i: true }, "flux-2-max:1MP:3ref"],
    [{ provider: "flux-2-max", resolution: "4 MP", refCount: 8, swapToI2i: true }, "flux-2-max:4MP:8ref"],
    [{ provider: "flux-2-pro", refCount: 0, swapToI2i: true }, "flux-2-pro:1MP:0ref"],
    [{ provider: "seedream-5-lite", refCount: 1, swapToI2i: true }, "seedream-5-lite-i2i"],
    [{ provider: "seedream", quality: "high", refCount: 0, swapToI2i: true }, "seedream:high"],
    [{ provider: "gpt-image", quality: "high", refCount: 0, swapToI2i: true }, "gpt-image:high"],
    [{ provider: "flux", resolution: "2K", refCount: 0, swapToI2i: true }, "flux:2K"],
    [{ provider: "nano-banana-pro", resolution: "4K", refCount: 0, swapToI2i: true }, "nano-banana-pro:4K"],
    [{ provider: "gpt-image-2", resolution: "4K", aspectRatio: "16:9", refCount: 0, swapToI2i: true }, "gpt-image-2:4K"],
    [{ provider: "ideogram-v3", renderingSpeed: "TURBO", refCount: 0, swapToI2i: true }, "ideogram-v3:TURBO"],
    [{ provider: undefined, refCount: 0, swapToI2i: true }, "nano-banana"],
  ] as const)("%o -> %s", (opts, expected) => {
    expect(resolveImageGenCreditIdentifier({ ...opts } as Parameters<typeof resolveImageGenCreditIdentifier>[0])).toBe(expected)
  })
})
