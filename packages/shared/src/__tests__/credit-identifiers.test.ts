import {
  buildCreditModelIdentifier,
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
})

// ---------------------------------------------------------------------------
// buildVideoCreditModelIdentifier
// ---------------------------------------------------------------------------
describe("buildVideoCreditModelIdentifier", () => {
  // --- Non-duration-priced providers ---
  describe("non-duration-priced providers", () => {
    it("minimax returns plain provider", () => {
      expect(buildVideoCreditModelIdentifier("minimax")).toBe("minimax")
    })

    it("veo3 returns plain provider", () => {
      expect(buildVideoCreditModelIdentifier("veo3", 10)).toBe("veo3")
    })

    it("runway-kie returns plain provider", () => {
      expect(buildVideoCreditModelIdentifier("runway-kie", 5)).toBe("runway-kie")
    })
  })

  // --- Duration tiers for kling-3.0 ---
  describe("kling-3.0 duration tiers", () => {
    it("5s duration returns :5s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 5)).toBe("kling-3.0:5s")
    })

    it("3s duration falls into 5s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 3)).toBe("kling-3.0:5s")
    })

    it("10s duration returns :10s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 10)).toBe("kling-3.0:10s")
    })

    it("7s duration falls into 10s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 7)).toBe("kling-3.0:10s")
    })

    it("15s duration returns :15s tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 15)).toBe("kling-3.0:15s")
    })

    it("duration exceeding max tier clamps to last tier (20s -> 15s)", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 20)).toBe("kling-3.0:15s")
    })

    it("duration exceeding max tier clamps to last tier (100s -> 15s)", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 100)).toBe("kling-3.0:15s")
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
      expect(buildVideoCreditModelIdentifier("kling-3.0", "10")).toBe("kling-3.0:10s")
    })

    it('string duration "5" works', () => {
      expect(buildVideoCreditModelIdentifier("kling", "5")).toBe("kling:5s")
    })

    it("NaN duration defaults to 5", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", "abc")).toBe("kling-3.0:5s")
    })

    it("undefined duration defaults to 5", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0")).toBe("kling-3.0:5s")
    })

    it("0 duration falls into first tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 0)).toBe("kling-3.0:5s")
    })

    it("1 duration falls into first tier", () => {
      expect(buildVideoCreditModelIdentifier("kling-3.0", 1)).toBe("kling-3.0:5s")
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

    describe("seedance-2-fast", () => {
      it("1080p 8s no-ref -> :8s:1080p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2-fast", 8, false, undefined, undefined, "1080p", false),
        ).toBe("seedance-2-fast:8s:1080p")
      })

      it("1080p 8s with ref -> :8s:1080p-ref", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2-fast", 8, false, undefined, undefined, "1080p", true),
        ).toBe("seedance-2-fast:8s:1080p-ref")
      })

      it("1080p 12s no-ref -> :12s:1080p", () => {
        expect(
          buildVideoCreditModelIdentifier("seedance-2-fast", 12, false, undefined, undefined, "1080p", false),
        ).toBe("seedance-2-fast:12s:1080p")
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
