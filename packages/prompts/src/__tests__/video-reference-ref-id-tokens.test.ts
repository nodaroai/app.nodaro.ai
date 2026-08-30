/**
 * `{ref:<id>}` / `{ref:<id>:<label>}` — id-addressed reference tokens.
 *
 * A client that names a reference by the `connectedReferences[].id` it sent
 * (Studio's bound `@`-chips) gets the `@image_N` slot substituted by the
 * platform AFTER the platform has numbered the references. That removes the
 * client-side mirror of the numbering walk — the one duplicated rule that could
 * silently misbind pictures for a client built against an older package.
 *
 * Contract pinned here:
 *   - the slot comes from the SAME walk that numbers the directives (mention
 *     URLs → canonical fallback → extras, offset by the leading flat refs);
 *   - the token is resolved BEFORE the `referenceOrder` reorder, so the
 *     renumber pass carries the binding to the ref's final seat — the opposite
 *     of `{image:N}`, which is resolved AFTER it to keep the author's N;
 *   - an unresolvable token never ships raw: label → the ref's display name
 *     (when the id is known) → "";
 *   - a prompt with no `{ref:` token is byte-identical to before.
 */
import { describe, it, expect } from "vitest"
import {
  resolveVideoReferenceCore,
  resolveRefIdTokens,
  resolveReferenceTokens,
} from "../video-reference-resolver.js"
import type { ConnectedReference } from "@nodaro/shared"

const charRef = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "char-kira", defaultName: "Kira", source: "wired-character", url: "https://r2/kira.png",
  characterSlug: "kira", variantSlug: undefined, characterCanonicalDescription: null,
  variantDescription: null, variantDisplayName: "canonical", ...over,
})

const A = "https://cdn/a.png"
const B = "https://cdn/b.png"

/** Every case: the token must be gone, whatever it resolved to. */
function expectNoRawToken(prompt: string | undefined) {
  expect(prompt ?? "").not.toMatch(/\{ref:/i)
}

describe("resolveVideoReferenceCore — {ref:<id>} id-addressed tokens", () => {
  it("bare {ref:<id>} binds an image extra to its @image_N slot", () => {
    const out = resolveVideoReferenceCore({
      prompt: "drive {ref:car-1} fast",
      wiredCharRefs: [],
      extraRefs: [{ id: "car-1", url: "https://r2/car.png", description: "a red car" }],
    })
    expect(out.additionalUrls).toEqual(["https://r2/car.png"])
    expect(out.prompt).toContain("- @image_1 (reference): a red car.")
    expect(out.prompt).toContain("drive @image_1 fast")
    expectNoRawToken(out.prompt)
  })

  it("labeled {ref:<id>:<label>} binds through REF_BINDING.image (parity with {image:N:label})", () => {
    const out = resolveVideoReferenceCore({
      prompt: "drive {ref:car-1:car} fast",
      wiredCharRefs: [],
      extraRefs: [{ id: "car-1", url: "https://r2/car.png", description: "a red car" }],
    })
    expect(out.prompt).toContain("drive the car from @image_1 fast")
    expectNoRawToken(out.prompt)
  })

  it("a canonical wired character binds to its canonical-fallback slot", () => {
    const out = resolveVideoReferenceCore({
      prompt: "{ref:char-kira} walks in",
      wiredCharRefs: [charRef()],
    })
    expect(out.additionalUrls).toEqual(["https://r2/kira.png"])
    expect(out.prompt).toContain("Use these characters:")
    expect(out.prompt).toContain("@image_1 walks in")
    expectNoRawToken(out.prompt)
  })

  it("a character VIEW (extra with characterSlug) binds to its pair-back slot after the canonical", () => {
    const out = resolveVideoReferenceCore({
      prompt: "{ref:view-1} turns to face {ref:char-kira}",
      wiredCharRefs: [charRef()],
      extraRefs: [{ id: "view-1", url: "https://r2/kira-side.png", characterSlug: "kira", description: "side profile" }],
    })
    expect(out.additionalUrls).toEqual(["https://r2/kira.png", "https://r2/kira-side.png"])
    expect(out.prompt).toContain("- @image_2 is the same subject as @image_1, side profile.")
    expect(out.prompt).toContain("@image_2 turns to face @image_1")
    expectNoRawToken(out.prompt)
  })

  it("leading flat refs offset the slot (D5 image-refs-first)", () => {
    const out = resolveVideoReferenceCore({
      prompt: "the {ref:obj} on the table",
      wiredCharRefs: [],
      leadingRefUrls: [A],
      extraRefs: [{ id: "obj", url: B, description: "object" }],
    })
    expect(out.additionalUrls).toEqual([A, B])
    expect(out.prompt).toContain("the @image_2 on the table")
    expectNoRawToken(out.prompt)
  })

  it("ids are opaque: `:` and `/` inside an id resolve, and a trailing label still parses", () => {
    const out = resolveVideoReferenceCore({
      prompt: "{ref:https://cdn/pic.png} beside {ref:kira:smile:smile}",
      wiredCharRefs: [],
      extraRefs: [
        { id: "https://cdn/pic.png", url: "https://cdn/pic.png", description: "pic" },
        { id: "kira:smile", url: "https://r2/kira-smile.png", description: "smile" },
      ],
    })
    expect(out.prompt).toContain("@image_1 beside the smile from @image_2")
    expectNoRawToken(out.prompt)
  })

  it("an unknown id degrades to its label, or to nothing — never the raw token", () => {
    const out = resolveVideoReferenceCore({
      prompt: "a {ref:nope:ghost} b {ref:nope2} c",
      wiredCharRefs: [],
      extraRefs: [{ id: "x", url: A, description: "d" }],
    })
    expect(out.prompt).toContain("a ghost b c")
    expectNoRawToken(out.prompt)
  })

  it("a known ref the walk never seated degrades to its display name", () => {
    // A wired character with no url is skipped by the canonical loop — the id
    // is known (so the name is), but there is no slot to bind.
    const out = resolveVideoReferenceCore({
      prompt: "{ref:char-kira} waves at {ref:capped-1}",
      wiredCharRefs: [charRef({ url: "" })],
      extraRefs: [{ id: "x", url: A, description: "d" }],
      // The caller's full id → name map (the route builds it from EVERY
      // connectedReference, including the ones it capped out before the walk).
      refNamesById: new Map([["capped-1", "Truck"]]),
    })
    expect(out.prompt).toContain("Kira waves at Truck")
    expectNoRawToken(out.prompt)
  })

  it("a duplicate-URL extra never binds past the payload: its {ref:} degrades to its name", () => {
    // The walk counts every extra with a url while `merged` dedups by URL, so
    // the second extra's directive is numbered @image_2 although the payload
    // carries ONE image (pre-existing walk-vs-merged drift). The token is
    // range-gated against the image count, so it degrades instead of emitting
    // a phantom binding.
    const out = resolveVideoReferenceCore({
      prompt: "{ref:x} then {ref:y}",
      wiredCharRefs: [],
      extraRefs: [
        { id: "x", url: A, description: "first" },
        { id: "y", url: A, description: "second" },
      ],
      refNamesById: new Map([["y", "Second"]]),
    })
    expect(out.additionalUrls).toEqual([A])
    expect(out.prompt).toContain("@image_1 then Second")
    expectNoRawToken(out.prompt)
  })

  it("resolves BEFORE the referenceOrder reorder, so the binding follows the ref to its final seat", () => {
    const out = resolveVideoReferenceCore({
      prompt: "{ref:y} leads, {ref:x} follows",
      wiredCharRefs: [],
      extraRefs: [
        { id: "x", url: A, description: "ax" },
        { id: "y", url: B, description: "by" },
      ],
      // Extras' tile ids are `wired:<url>` (the reorder contract, unchanged).
      referenceOrder: [`wired:${B}`, `wired:${A}`],
    })
    expect(out.additionalUrls).toEqual([B, A])
    expect(out.prompt).toContain("@image_1 leads, @image_2 follows")
    expect(out.prompt).toContain("- @image_1 (reference): by.")
    expect(out.prompt).toContain("- @image_2 (reference): ax.")
    expectNoRawToken(out.prompt)
  })

  it("keeps {image:N} resolved AFTER the reorder (author's N kept) while {ref:} follows the ref", () => {
    const out = resolveVideoReferenceCore({
      prompt: "{ref:y} and {image:2:second}",
      wiredCharRefs: [],
      extraRefs: [
        { id: "x", url: A, description: "ax" },
        { id: "y", url: B, description: "by" },
      ],
      referenceOrder: [`wired:${B}`, `wired:${A}`],
    })
    // y moved to seat 1 → {ref:y} rides along; {image:2} keeps the literal 2.
    expect(out.prompt).toContain("@image_1 and the second from @image_2")
    expectNoRawToken(out.prompt)
  })

  it("an @-mentioned character's ref binds to the mention's slot", () => {
    const out = resolveVideoReferenceCore({
      prompt: "@kira:1 waves, then {ref:char-kira} sits",
      wiredCharRefs: [charRef()],
    })
    expect(out.additionalUrls).toEqual(["https://r2/kira.png"])
    expect(out.prompt).toContain("Kira waves, then @image_1 sits")
    expectNoRawToken(out.prompt)
  })

  it("is independent of hybridRoles — same slot, no legend block", () => {
    const out = resolveVideoReferenceCore({
      prompt: "drive {ref:car-1} fast",
      wiredCharRefs: [],
      extraRefs: [{ id: "car-1", url: "https://r2/car.png", description: "a red car" }],
      hybridRoles: true,
    })
    expect(out.prompt).not.toContain("Use these characters:")
    expect(out.prompt).toContain("drive @image_1 fast")
    expectNoRawToken(out.prompt)
  })

  it("a prompt with no {ref: token is untouched — `{ref}` and `ref:` are not tokens", () => {
    const out = resolveVideoReferenceCore({
      prompt: "circle {image:1:object} {ref} ref: x",
      wiredCharRefs: [],
      extraRefs: [{ id: "car-1", url: "https://r2/car.png", description: "a red car" }],
    })
    expect(out.prompt).toContain("circle the object from @image_1 {ref} ref: x")
  })

  it("an empty id drops to nothing and the keyword is case-insensitive", () => {
    const out = resolveVideoReferenceCore({
      prompt: "x {ref:} {REF:car-1} y",
      wiredCharRefs: [],
      extraRefs: [{ id: "car-1", url: "https://r2/car.png", description: "a red car" }],
    })
    expect(out.prompt).toContain("x @image_1 y")
    expectNoRawToken(out.prompt)
  })

  it("imageRefCount: 0 (no image tokens may bind) degrades a seated ref to its name", () => {
    const out = resolveVideoReferenceCore({
      prompt: "{ref:char-kira} walks",
      wiredCharRefs: [charRef()],
      imageRefCount: 0,
    })
    expect(out.prompt).toContain("Kira walks")
    expect(out.prompt).not.toContain("@image_1 walks")
    expectNoRawToken(out.prompt)
  })

  it("early-return path (no wired chars, no extras): degrades to name / label / nothing", () => {
    const out = resolveVideoReferenceCore({
      prompt: "{ref:a} and {ref:b:the dog} and {ref:c}",
      wiredCharRefs: [],
      leadingRefUrls: [A],
      refNamesById: new Map([["a", "Alpha"]]),
    })
    expect(out.additionalUrls).toEqual([A])
    expect(out.prompt).toBe("Alpha and the dog and")
    expectNoRawToken(out.prompt)
  })
})

describe("resolveRefIdTokens — malformed and adversarial input", () => {
  it("a malformed token (brace inside the id, no closing brace) never ships its `{ref:` prefix", () => {
    const out = resolveRefIdTokens("x {ref:a{b} y {ref:unclosed z", {
      slotById: new Map([["a", 1]]),
      nameById: new Map(),
      imageCount: 1,
    })
    expect(out).not.toMatch(/\{ref:/i)
    // The net is bounded by whitespace/braces: the prose after each run survives.
    expect(out).toContain(" y ")
    expect(out).toContain(" z")
  })

  it("scans a prompt at the hard ceiling with an adversarial shape and still resolves (linear matcher)", () => {
    // 30k chars of `{ref:` followed by label-class text with no closing brace —
    // the shape that made a lazy-quantifier matcher quadratic.
    const adversarial = "{ref:" + ":a".repeat(15000)
    const out = resolveRefIdTokens(`${adversarial} end {ref:x}`, {
      slotById: new Map([["x", 1]]),
      nameById: new Map(),
      imageCount: 1,
    })
    expect(out).not.toMatch(/\{ref:/i)
    expect(out).toContain("end @image_1")
  })
})

describe("resolveRefIdTokens (standalone — the route's no-image-ref early return)", () => {
  it("binds in-range slots, and degrades label → name → nothing otherwise", () => {
    const resolved = resolveRefIdTokens("{ref:x:car} {ref:x} {ref:y:dog} {ref:y} {ref:z}", {
      slotById: new Map([["x", 2], ["y", 4]]),
      nameById: new Map([["y", "Dog"]]),
      imageCount: 3,
    })
    // y is seated at 4 but only 3 images ship → name; z is unknown → nothing.
    expect(resolveReferenceTokens(resolved, { image: 3, video: 0, audio: 0 })).toBe(
      "the car from @image_2 @image_2 dog Dog",
    )
  })

  it("returns the prompt untouched when no {ref: token is present", () => {
    const prompt = "plain {image:1} prose"
    expect(resolveRefIdTokens(prompt, { slotById: new Map(), nameById: new Map(), imageCount: 0 })).toBe(prompt)
    expect(resolveRefIdTokens(undefined, { slotById: new Map(), nameById: new Map(), imageCount: 0 })).toBeUndefined()
  })
})
