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

// ══════════════════════════════════════════════════════════════════════════
// Task F4 — symmetric per-mention lock FORCE-OFF (`~nolock`) + tri-state
// ══════════════════════════════════════════════════════════════════════════
//
// `~nolock` is the mirror of `~lock`: it FORCES the per-reference identity lock
// OFF, suppressing a ref-level `identityLock.enabled = true`. Tri-state:
//   `~lock`   → lock:true  (force ON)
//   `~nolock` → lock:false (force OFF)
//   neither   → lock ABSENT (undefined — inherit the ref/source default)
// Additive + hybrid-gated; legacy byte-identical + inert.

const victoriaLocked: ConnectedReference = { ...victoria, identityLock: { enabled: true } }
const libraryLocked: ConnectedReference = { ...library, identityLock: { enabled: true } }

describe("parseCharacterMentionToken — additive ~nolock (force off)", () => {
  it("parses a trailing ~nolock on a mode token → lock:false", () => {
    expect(parseCharacterMentionToken("@kira:1:face~nolock")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: "face",
      lock: false,
    })
  })

  it("parses ~nolock on a bare 2-part token → lock:false", () => {
    expect(parseCharacterMentionToken("@kira:1~nolock")).toEqual({
      characterSlug: "kira",
      imageIndex: 1,
      variantSlug: null,
      usageMode: null,
      lock: false,
    })
  })

  it("~nolock is NOT mis-parsed as ~lock (endsWith('~lock') is false)", () => {
    const parsed = parseCharacterMentionToken("@kira:1:face~nolock")
    expect(parsed?.lock).toBe(false)
    expect(parsed?.usageMode).toBe("face")
  })
})

describe("findCharacterMentionTokens — additive ~nolock", () => {
  it("captures the full ~nolock token + lock:false at the right offset", () => {
    expect(findCharacterMentionTokens("Hi @kira:1:face~nolock waves", ["kira"])).toEqual([
      {
        token: "@kira:1:face~nolock",
        characterSlug: "kira",
        imageIndex: 1,
        variantSlug: null,
        usageMode: "face",
        lock: false,
        offset: 3,
      },
    ])
  })

  it("WORD-BOUNDARY: ~nolockx stays literal (token is @kira:1, no lock)", () => {
    expect(findCharacterMentionTokens("@kira:1~nolockx in", ["kira"])).toEqual([
      { token: "@kira:1", characterSlug: "kira", imageIndex: 1, variantSlug: null, usageMode: null, offset: 0 },
    ])
  })
})

describe("parseLocationMentionToken — additive ~nolock (force off)", () => {
  it("parses ~nolock on a role token → role + lock:false", () => {
    expect(parseLocationMentionToken("@old-library:1:background~nolock")).toEqual({
      locationSlug: "old-library",
      imageIndex: 1,
      bucket: null,
      variant: null,
      usageMode: null,
      role: "background",
      lock: false,
    })
  })

  it("parses ~nolock on a bucket/variant + mode token → lock:false", () => {
    expect(parseLocationMentionToken("@old-library:1:weather/rain:style~nolock")).toEqual({
      locationSlug: "old-library",
      imageIndex: 1,
      bucket: "weather",
      variant: "rain",
      usageMode: "style",
      lock: false,
    })
  })
})

describe("hybrid image — per-mention ~nolock suppresses a ref-level enabled lock", () => {
  it("@victoria-hayes:1:face~nolock (ref enabled:true) → phrase but NO lock line", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:face~nolock on a rooftop",
      connectedReferences: [victoriaLocked],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the face from reference image A on a rooftop")
    expect(out.prompt).not.toContain("Lock the exact identity")
    expect(out.prompt).not.toContain("@victoria-hayes")
  })

  it("@victoria-hayes:1:face (inherit, ref enabled:true) → lock line PRESENT", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:face on a rooftop",
      connectedReferences: [victoriaLocked],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain(CHAR_LOCK_LINE)
  })

  it("@victoria-hayes:1:face~lock (ref enabled:true) → lock line still PRESENT", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:face~lock on a rooftop",
      connectedReferences: [victoriaLocked],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain(CHAR_LOCK_LINE)
  })

  it("location @old-library:1:background~nolock (ref enabled:true) → NO lock line", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:background~nolock a scene",
      connectedReferences: [libraryLocked],
      referenceFormat: "hybrid",
    })
    expect(out.prompt).toContain("the background from reference image A")
    expect(out.prompt).not.toContain("Lock the exact look")
  })
})

describe("legacy — ~nolock is inert (like ~lock)", () => {
  it("LEGACY character @…:face~nolock → no hybrid phrase, no lock line", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@victoria-hayes:1:face~nolock on a rooftop",
      connectedReferences: [victoria],
    })
    expect(out.prompt).not.toContain("Lock the exact identity")
    expect(out.prompt).not.toContain("the face from reference image")
  })

  it("LEGACY location role @…:background~nolock stays literal", () => {
    const out = buildImagePrompt({
      provider: "nano-banana-pro",
      prompt: "@old-library:1:background~nolock a scene",
      connectedReferences: [library],
    })
    expect(out.prompt).toContain("@old-library:1:background~nolock")
    expect(out.prompt).not.toContain("the background from reference image")
  })
})

describe("video hybrid — per-mention ~nolock suppresses the lock line", () => {
  it("@kira:1:face~nolock (ref enabled:true) → phrase but NO lock line", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:face~nolock runs",
      wiredCharRefs: [kira({ identityLock: { enabled: true } })],
      hybridRoles: true,
    })
    expect(out.prompt).toContain("the face from @image_1 runs")
    expect(out.prompt).not.toContain("Lock the exact identity")
  })

  it("@kira:1:face (inherit, ref enabled:true) → lock line PRESENT", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1:face runs",
      wiredCharRefs: [kira({ identityLock: { enabled: true } })],
      hybridRoles: true,
    })
    expect(out.prompt).toContain("Lock the exact identity of the person in @image_1")
  })
})
