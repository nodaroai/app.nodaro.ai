/**
 * Per-mention identity-lock toggle (Unified Reference Roles, Task 4).
 *
 * An ADDITIVE, trailing `~lock` sentinel on a character/location mention token
 * (`@kira:1:face~lock`, `@old-library:1:background~lock`) parses to a
 * `lock: true` token-info field. The HYBRID resolvers force
 * `identityLock.enabled = true` for that mention's reference before
 * `buildIdentityLockLine`, so a per-mention lock line appears — regardless of
 * the ref's default (default-off) lock.
 *
 * CRITICAL INVARIANTS pinned here:
 *   - A `~lock`-LESS token parses + resolves BYTE-IDENTICALLY to pre-Task-4
 *     (the parser must NOT gain a `lock` key for a lock-less token).
 *   - LEGACY is inert: the `~lock` flag never produces a lock line and never
 *     changes lock resolution (the legacy resolvers ignore it).
 *   - Hybrid character (image + video) + hybrid location honor the flag.
 */

import { describe, it, expect } from "vitest"
import {
  parseCharacterMentionToken,
  findCharacterMentionTokens,
} from "../character-mention-slug.js"
import {
  parseLocationMentionToken,
  findLocationMentionTokens,
} from "../location-mention-slug.js"
import { buildIdentityLockLine } from "../identity-lock.js"
import { buildImagePrompt } from "../prompt-builder.js"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"
import type { ConnectedReference } from "../types.js"

const CHAR_LOCK_LINE =
  "Lock the exact identity of the person in reference image A — face, bone structure, skin tone, and all unique features."
const LOC_LOCK_LINE =
  "Lock the exact look of reference image A — match the location's architecture, layout, and lighting."

// ─── Parser: additive `~lock` (character) ────────────────────────────────────

describe("parseCharacterMentionToken — additive ~lock", () => {
  it("parses a trailing ~lock on a mode token → lock:true", () => {
    expect(parseCharacterMentionToken("@kira:1:face~lock")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: "face",
      lock: true,
    })
  })

  it("parses ~lock on a bare 2-part token", () => {
    expect(parseCharacterMentionToken("@kira:1~lock")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: null,
      lock: true,
    })
  })

  it("parses ~lock on a variant token", () => {
    expect(parseCharacterMentionToken("@kira:1:smile~lock")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: "smile",
      usageMode: null,
      lock: true,
    })
  })

  it("parses ~lock on a 4-part variant+mode token", () => {
    expect(parseCharacterMentionToken("@kira:1:smile:face~lock")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: "smile",
      usageMode: "face",
      lock: true,
    })
  })

  it("BYTE-IDENTICAL: a ~lock-less token gains NO lock key", () => {
    const parsed = parseCharacterMentionToken("@kira:1:face")
    expect(parsed).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: "face",
    })
    expect(parsed).not.toHaveProperty("lock")
  })
})

describe("findCharacterMentionTokens — additive ~lock", () => {
  it("captures the full ~lock token + lock:true at the right offset", () => {
    const tokens = findCharacterMentionTokens("Hi @kira:1:face~lock waves", ["kira"])
    expect(tokens).toEqual([
      {
        token: "@kira:1:face~lock",
        characterSlug: "kira",
        imageIndex: 1,
        variantSlug: null,
        usageMode: "face",
        lock: true,
        offset: 3,
      },
    ])
  })

  it("BYTE-IDENTICAL: lock-less tokens are unchanged (no lock key)", () => {
    expect(findCharacterMentionTokens("@kira:1:face waves", ["kira"])).toEqual([
      { token: "@kira:1:face", characterSlug: "kira", imageIndex: 1, variantSlug: null, usageMode: "face", offset: 0 },
    ])
  })

  it("WORD-BOUNDARY: ~lock is NOT consumed inside a longer word (~locked)", () => {
    // `~lock(?![a-z0-9-])` — a trailing `~locked` is ordinary text, so the token
    // stays `@kira:1` (no lock) and `~locked` is left literal, byte-identical.
    const tokens = findCharacterMentionTokens("@kira:1~locked in", ["kira"])
    expect(tokens).toEqual([
      { token: "@kira:1", characterSlug: "kira", imageIndex: 1, variantSlug: null, usageMode: null, offset: 0 },
    ])
  })
})

// ─── Parser: additive `~lock` (location) ─────────────────────────────────────

describe("parseLocationMentionToken — additive ~lock", () => {
  it("parses ~lock on a role token → role + lock:true", () => {
    expect(parseLocationMentionToken("@old-library:1:background~lock")).toEqual({
      locationSlug: "old-library",
      imageIndex: 1,
      bucket: null,
      variant: null,
      usageMode: null,
      role: "background",
      lock: true,
    })
  })

  it("parses ~lock on a bare canonical token", () => {
    expect(parseLocationMentionToken("@old-library:1~lock")).toEqual({
      locationSlug: "old-library",
      imageIndex: 1,
      bucket: null,
      variant: null,
      usageMode: null,
      lock: true,
    })
  })

  it("parses ~lock on a bucket/variant + mode token", () => {
    expect(parseLocationMentionToken("@old-library:1:weather/rain:style~lock")).toEqual({
      locationSlug: "old-library",
      imageIndex: 1,
      bucket: "weather",
      variant: "rain",
      usageMode: "style",
      lock: true,
    })
  })

  it("BYTE-IDENTICAL: a ~lock-less role token gains NO lock key", () => {
    const parsed = parseLocationMentionToken("@old-library:1:background")
    expect(parsed).toEqual({
      locationSlug: "old-library",
      imageIndex: 1,
      bucket: null,
      variant: null,
      usageMode: null,
      role: "background",
    })
    expect(parsed).not.toHaveProperty("lock")
  })
})

describe("findLocationMentionTokens — additive ~lock", () => {
  it("captures the full ~lock token + lock:true", () => {
    const tokens = findLocationMentionTokens("at @old-library:1:background~lock now", ["old-library"])
    expect(tokens).toEqual([
      {
        token: "@old-library:1:background~lock",
        locationSlug: "old-library",
        imageIndex: 1,
        bucket: null,
        variant: null,
        usageMode: null,
        role: "background",
        lock: true,
        offset: 3,
      },
    ])
  })
})

// ─── DEFAULT_LOCK_TEXT gains a wired-location wording ─────────────────────────

describe("buildIdentityLockLine — wired-location default wording", () => {
  it("enabled:true + no custom text → the built-in location lock line", () => {
    expect(
      buildIdentityLockLine(
        { id: "l", defaultName: "Old Library", source: "wired-location", url: "u", identityLock: { enabled: true } },
        "reference image A",
      ),
    ).toBe(LOC_LOCK_LINE)
  })

  it("still default-OFF for a location with no flag", () => {
    expect(
      buildIdentityLockLine({ id: "l", defaultName: "Old Library", source: "wired-location", url: "u" }, "reference image A"),
    ).toBeNull()
  })
})

// ─── Hybrid resolver override — image (character) ─────────────────────────────

const victoria: ConnectedReference = {
  id: "v", defaultName: "Victoria Hayes", source: "wired-character",
  url: "https://cdn/victoria.png", characterSlug: "victoria-hayes",
}
const library: ConnectedReference = {
  id: "l", defaultName: "Old Library", source: "wired-location",
  url: "https://cdn/library.png", locationSlug: "old-library",
}

describe("hybrid image — per-mention ~lock forces the lock line", () => {
  it("@victoria-hayes:1:face~lock → phrase + character lock line (ref default off)", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:face~lock on a rooftop",
      connectedReferences: [victoria],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the face from reference image A on a rooftop")
    expect(out.prompt).toContain(CHAR_LOCK_LINE)
    expect(out.prompt).not.toContain("@victoria-hayes")
  })

  it("@victoria-hayes:1:face (no flag) → NO lock line (unchanged default-off)", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:face on a rooftop",
      connectedReferences: [victoria],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the face from reference image A on a rooftop")
    expect(out.prompt).not.toContain("Lock the exact identity")
  })

  it("@old-library:1:background~lock → phrase + location lock line", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:background~lock a chase scene",
      connectedReferences: [library],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the background from reference image A")
    expect(out.prompt).toContain(LOC_LOCK_LINE)
    expect(out.prompt).not.toContain("@old-library")
  })

  it("@old-library:1:background (no flag) → NO lock line", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:background a chase scene",
      connectedReferences: [library],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the background from reference image A")
    expect(out.prompt).not.toContain("Lock the exact look")
  })
})

// ─── Legacy inertness ────────────────────────────────────────────────────────

describe("legacy — ~lock is inert (no lock, no different lock resolution)", () => {
  it("LEGACY character @…:face~lock → no lock line", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:face~lock on a rooftop",
      connectedReferences: [victoria],
      // no referenceFormat → legacy (prod default kill-switch)
    })
    expect(out.prompt).not.toContain("Lock the exact identity")
    expect(out.prompt).not.toContain("the face from reference image")
  })

  it("LEGACY location role @…:background~lock stays literal, no lock, no hybrid phrase", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:background~lock a scene",
      connectedReferences: [library],
    })
    // Role token (incl ~lock) is left verbatim, exactly like the role-only case.
    expect(out.prompt).toContain("@old-library:1:background~lock")
    expect(out.prompt).not.toContain("Lock the exact look")
    expect(out.prompt).not.toContain("the background from reference image")
    expect(out.prompt).not.toContain("Use these locations:")
  })
})

// ─── Video parity (character hybrid) ─────────────────────────────────────────

const kira = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "k", defaultName: "Kira", source: "wired-character", url: "u-kira", characterSlug: "kira", ...over,
})

describe("video hybrid — per-mention ~lock forces the lock line", () => {
  it("@kira:1:face~lock → 'the face from @image_1' + lock line", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:face~lock runs", wiredCharRefs: [kira()], hybridRoles: true,
    })
    expect(out.prompt).toContain("the face from @image_1 runs")
    expect(out.prompt).toContain("Lock the exact identity of the person in @image_1")
  })

  it("@kira:1:face (no flag) → NO lock line (unchanged)", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:face runs", wiredCharRefs: [kira()], hybridRoles: true,
    })
    expect(out.prompt).toContain("the face from @image_1 runs")
    expect(out.prompt).not.toContain("Lock the exact identity")
  })

  it("LEGACY video @kira:1:face~lock → no lock line", () => {
    const out = resolveVideoReferenceCore({ prompt: "@kira:1:face~lock runs", wiredCharRefs: [kira()] })
    expect(out.prompt).not.toContain("Lock the exact identity")
  })
})
