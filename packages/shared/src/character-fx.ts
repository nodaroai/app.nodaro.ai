/**
 * Canonical catalog of character-driven effects for AI-video generation.
 *
 * Shared between frontend (picker UI, prompt hint injection) and backend
 * (orchestrator payload builder). The `promptHint` is a natural-language
 * cue that gets composed into the user prompt when a character-fx node
 * is connected to a video consumer.
 *
 * Every `promptHint` references "the subject" at least once — the composer
 * does a global regex replace of "the subject" with the target ref's
 * display name (character/face/object/location) when a target is wired.
 *
 * Multi-pick supported: value field accepts `string | string[]` (cap 2).
 * Per-id substitution: each base hint is independently rewritten BEFORE
 * the join, so "Aria transforms into a werewolf, and Aria opens their
 * mouth and exhales..." reads correctly.
 *
 * null input is treated like undefined (falsy short-circuit → returns "")
 */

export type CharacterFxCategory =
  | "transformation"
  | "power"
  | "body-mod"
  | "face-expression"
  | "aura-ambient"

export interface CharacterFx {
  readonly id: string
  readonly label: string
  readonly category: CharacterFxCategory
  readonly description: string
  readonly promptHint: string
}

export type CharacterFxPosition  = "auto" | "start" | "middle" | "end" | "full"
export type CharacterFxDuration  = "auto" | "instant" | "short" | "medium" | "long"
export type CharacterFxIntensity = "auto" | "subtle" | "natural" | "dynamic" | "crazy"

export interface CharacterFxTiming {
  position?:  CharacterFxPosition
  duration?:  CharacterFxDuration
  intensity?: CharacterFxIntensity
}

export const CHARACTER_FX: ReadonlyArray<CharacterFx> = [
  // ============================================================================
  // TRANSFORMATION — 14 entries — subject becomes a different entity
  // (12 transformations + 2 defaults: "auto" / "none")
  // ============================================================================
  { id: "auto",                 label: "Auto",                   category: "transformation", description: "Let the model choose", promptHint: "" },
  { id: "none",                 label: "None",                   category: "transformation", description: "No character effect", promptHint: "" },
  { id: "werewolf",             label: "Werewolf",               category: "transformation", description: "Transforms into a werewolf",
    promptHint: "the subject transforms into a werewolf — fur sprouts across the skin, fangs and claws extend, the snout elongates, eyes glow yellow, body re-shapes with visible muscle and bone movement, clothing tears" },
  { id: "vampire",              label: "Vampire",                category: "transformation", description: "Transforms into a vampire",
    promptHint: "the subject transforms into a vampire — skin pales, fangs extend, eyes shift to crimson, pupils dilate, posture shifts predatory, with a faint mist drifting around the body" },
  { id: "cyborg",               label: "Cyborg Reveal",          category: "transformation", description: "Skin peels back revealing cybernetics",
    promptHint: "the subject's skin peels open along seams to reveal glowing cybernetic mechanisms beneath — exposed circuit boards, hydraulic joints, blue LED indicators along the limbs and torso" },
  { id: "ghost-form",           label: "Ghost Form",             category: "transformation", description: "Body becomes translucent / ethereal",
    promptHint: "the subject becomes translucent and ethereal, body edges feathering into mist, faint inner glow visible through the skin, feet detaching from the ground in slow float" },
  { id: "statue-stone",         label: "Petrify to Stone",       category: "transformation", description: "Body petrifies into stone statue",
    promptHint: "the subject's body petrifies into grey weathered stone starting from the extremities and creeping inward, fine cracks forming as the transformation locks the pose into a statue" },
  { id: "liquid-metal",         label: "Liquid Metal",           category: "transformation", description: "T-1000 style liquid metal form",
    promptHint: "the subject's body shifts into glossy chrome-silver liquid metal that reflects the environment, surface rippling, features re-forming with mirror-smooth fluid motion (T-1000 style)" },
  { id: "animalization",        label: "Animalization",          category: "transformation", description: "Morphs into an animal",
    promptHint: "the subject morphs into a wild animal — body re-shaping, fur or feathers emerging, limbs reconfiguring, the head transforming into the animal's, eyes shifting to the animal's coloration" },
  { id: "gorilla-form",         label: "Gorilla Form",           category: "transformation", description: "Transforms into a gorilla",
    promptHint: "the subject transforms into a massive silverback gorilla — body bulks up dramatically, dark fur sprouts, face re-shapes with a heavy brow, posture shifts to hunched primate stance" },
  { id: "mystification",        label: "Mystification",          category: "transformation", description: "Magical aura wraps & transforms subject",
    promptHint: "the subject is enveloped in swirling magical particles and arcane symbols that orbit the body, the form within visibly shifting until the aura clears revealing the transformed subject" },
  { id: "gas-form",             label: "Gas Transformation",     category: "transformation", description: "Body dissipates into gaseous form",
    promptHint: "the subject's body dissolves into a swirling cloud of coloured gas that drifts and re-coalesces in the same space, the form re-condensing into a faintly altered version of the subject" },
  { id: "diamond-skin",         label: "Diamond Skin",           category: "transformation", description: "Body crystallizes into diamond facets",
    promptHint: "the subject's body crystallizes into faceted diamond — skin hardening into reflective gem facets that refract light in rainbow caustics, the silhouette holding the same pose" },
  { id: "agent-reveal",         label: "Agent Reveal",           category: "transformation", description: "Suit and shades materialize on subject",
    promptHint: "the subject's everyday clothing rapidly morphs into a sharp black suit, tie tightening, dark sunglasses materializing onto the face, posture stiffening into agent stance (Men-in-Black style)" },

  // ============================================================================
  // POWER — 12 entries — subject demonstrates a fantastical ability
  // ============================================================================
  { id: "fire-breathe",         label: "Fire Breathe",           category: "power", description: "Breathes a sustained jet of flame",
    promptHint: "the subject opens their mouth and exhales a sustained jet of orange-yellow fire that arcs forward through the frame, with smoke trailing and embers scattering, lighting their face in warm reflected glow" },
  { id: "ice-breathe",          label: "Ice Breathe",            category: "power", description: "Breathes a stream of freezing air",
    promptHint: "the subject exhales a stream of frigid pale-blue air with visible ice crystals forming in the breath, surfaces in front of them rapidly frosting over with creeping ice patterns" },
  { id: "air-bending",          label: "Air Bending",            category: "power", description: "Manipulates a swirling vortex of air",
    promptHint: "the subject's hands trace through the air and a visible swirling vortex of wind follows the gestures, dust and loose objects spiraling along the path of the conjured air currents" },
  { id: "water-bending",        label: "Water Bending",          category: "power", description: "Manipulates flowing water with gestures",
    promptHint: "the subject's hand gestures pull a ribbon of water into the air, the water arcing and twisting in fluid sculpted shapes that follow the motion of the fingertips" },
  { id: "earth-bending",        label: "Earth Bending",          category: "power", description: "Raises stone slabs from the ground",
    promptHint: "the subject stomps or gestures downward and slabs of stone or earth tear upward from the ground around them in geometric shards, dust and debris falling away as the rock rises" },
  { id: "lightning-hands",      label: "Lightning Hands",        category: "power", description: "Arcs of electricity from hands",
    promptHint: "the subject's hands crackle with bright blue-white electric arcs that branch outward in jagged forking patterns, the room flickering with the strobing illumination of the discharge" },
  { id: "levitation",           label: "Levitation",             category: "power", description: "Rises off the ground, body horizontal or vertical",
    promptHint: "the subject rises slowly off the ground in a controlled vertical lift, hair and loose clothing drifting upward in zero-gravity sway, faint heat-haze air distortion visible below the feet" },
  { id: "telekinesis",          label: "Telekinesis",            category: "power", description: "Nearby objects float and orbit",
    promptHint: "the subject extends a hand and nearby objects rise into the air around them, slowly rotating and orbiting in unsupported flight, debris and small items drawn into a halo of suspended motion" },
  { id: "invisibility",         label: "Invisibility",           category: "power", description: "Body fades to transparent / refractive",
    promptHint: "the subject's body fades into transparency with a faint refractive shimmer at the edges, only a barely-visible heat-haze outline indicating where they stand as they vanish from sight" },
  { id: "hero-flight",          label: "Hero Flight",            category: "power", description: "Launches into the sky in flight pose",
    promptHint: "the subject launches upward into the sky in a heroic superhero flight pose, arms forward, cape or clothing whipping behind, with a sonic-boom shockwave at the launch point" },
  { id: "super-speed",          label: "Super Speed",            category: "power", description: "Blurs into super-fast motion",
    promptHint: "the subject blurs into super-fast motion leaving multiple trailing afterimages and lightning-streak motion lines, the surrounding scene appearing momentarily frozen against their speed" },
  { id: "soul-departure",       label: "Soul Departure",         category: "power", description: "Translucent soul rises from body",
    promptHint: "a translucent luminous soul rises out of the subject's body, drifting upward as a ghost-like figure while the physical body remains in its pose, a faint silver thread connecting the two" },

  // ============================================================================
  // BODY-MOD — 9 entries — parts of the subject change / emerge / leave
  // ============================================================================
  { id: "wings-grow",           label: "Wings Grow",             category: "body-mod", description: "Wings sprout and unfurl from back",
    promptHint: "the subject's back arches and two large wings — feathered angelic or leathery demonic — unfurl outward from the shoulder blades, extending to full span behind them" },
  { id: "horns-grow",           label: "Horns Emerge",           category: "body-mod", description: "Horns push out from the head",
    promptHint: "the subject's forehead furrows as two pointed horns push outward from the skull, growing in a curving arc above the brows with the skin parting cleanly as the bone emerges" },
  { id: "tail-emerge",          label: "Tail Emerge",            category: "body-mod", description: "Tail extends from base of spine",
    promptHint: "a tail — feline, reptilian, or demonic — extends rapidly from the base of the subject's spine, swishing into motion behind them once fully grown" },
  { id: "tentacles-emerge",     label: "Tentacles Emerge",       category: "body-mod", description: "Tentacles writhe out from back / body",
    promptHint: "long writhing tentacles emerge from the subject's back or torso, slick and dark, snaking outward in undulating motion, the skin parting around the base of each appendage" },
  { id: "extra-eyes",           label: "Extra Eyes Open",        category: "body-mod", description: "Additional eyes open across face / body",
    promptHint: "additional eyes open across the subject's face, forehead, and body — blinking in sequence and tracking independently, with the skin smoothly accommodating each new aperture" },
  { id: "head-explode",         label: "Head Explosion",         category: "body-mod", description: "Head bursts apart violently (PG-13)",
    promptHint: "the subject's head bursts apart in a violent explosion of light and abstract particles, the body remaining standing momentarily before the camera cuts away — stylized, non-graphic" },
  { id: "head-off",             label: "Head Removal",           category: "body-mod", description: "Head detaches and floats free (PG-13, stylized)",
    promptHint: "the subject's head smoothly detaches from the neck and floats free above the body in stylized magical detachment, the body remaining poised and the head rotating to face the camera" },
  { id: "spiders-from-mouth",   label: "Spiders From Mouth",     category: "body-mod", description: "Spiders crawl out from open mouth (horror)",
    promptHint: "the subject's mouth opens wide and a stream of dark spiders crawls outward across the lips and cheeks, scattering down the face and body in a horror-genre reveal" },
  { id: "skin-surge",           label: "Skin Surge",             category: "body-mod", description: "Skin ripples with under-the-surface motion",
    promptHint: "the subject's skin ripples with visible wave-like surges of motion underneath the surface, as if something is shifting through the body, the skin stretching and re-settling in pulsing rhythm" },

  // ============================================================================
  // FACE-EXPRESSION — 8 entries — face contorts / mask / eyes change
  // ============================================================================
  { id: "horror-face",          label: "Horror Face",            category: "face-expression", description: "Face contorts into horror expression",
    promptHint: "the subject's face contorts into a horror expression — eyes widen and bulge, mouth stretches unnaturally wide, skin pales with visible veins emerging, jaw distending in unnatural proportions" },
  { id: "oni-mask",             label: "Oni Mask",               category: "face-expression", description: "Demon mask materializes over face",
    promptHint: "a red and gold oni demon mask materializes and slides into place over the subject's face, painted features sharp and menacing, with curling smoke and faint magical glyphs around the edges" },
  { id: "glowing-eyes",         label: "Glowing Eyes",           category: "face-expression", description: "Eyes ignite with internal light",
    promptHint: "the subject's eyes ignite with a brilliant internal glow — white, gold, or coloured — casting visible light beams outward and illuminating the bridge of the nose and upper cheeks" },
  { id: "floral-eyes",          label: "Floral Eyes",            category: "face-expression", description: "Flowers bloom from eye sockets",
    promptHint: "delicate flowers bloom outward from the subject's eye sockets, petals unfurling in slow motion to replace the eyes, vines drifting down the cheeks in surreal botanical reveal" },
  { id: "bloom-mouth",          label: "Bloom Mouth",            category: "face-expression", description: "Flowers bloom from open mouth",
    promptHint: "the subject opens their mouth and a cascade of flowers and vines blooms outward from within, unfurling in slow motion across the lower face in a surreal botanical reveal" },
  { id: "x-ray",                label: "X-Ray Reveal",           category: "face-expression", description: "Body becomes X-ray visible skeleton",
    promptHint: "the subject's body becomes semi-transparent in X-ray style, revealing the skeletal structure beneath with a faint cyan or green glow outlining bones and major internal organs" },
  { id: "agent-snap",           label: "Sunglasses Snap-On",     category: "face-expression", description: "Sunglasses materialize over eyes",
    promptHint: "dark sunglasses snap into place over the subject's eyes with a sharp visual punctuation — sometimes accompanied by lens flare bloom and a tight zoom on the bridge of the nose" },
  { id: "visor-x",              label: "Cyber Visor",            category: "face-expression", description: "Sci-fi cyber visor materializes",
    promptHint: "a futuristic cybernetic visor materializes across the subject's eyes — sleek, semi-transparent with internal HUD readouts visible, faint scanline shimmer across the surface" },

  // ============================================================================
  // AURA-AMBIENT — 14 entries — environmental FX bound to the subject
  // ============================================================================
  { id: "paparazzi",            label: "Paparazzi Flashes",      category: "aura-ambient", description: "Camera flashes pop around the subject",
    promptHint: "the subject stands or moves while multiple camera flash bursts pop intermittently around them from off-screen photographers, each flash briefly overexposing the subject's face in white bloom" },
  { id: "money-rain",           label: "Money Rain",             category: "aura-ambient", description: "Currency rains around subject",
    promptHint: "the subject stands or moves through a slow-motion cascade of currency notes raining down from above, bills fluttering and stacking around them, the money filling the air around the body" },
  { id: "color-rain",           label: "Color Rain",             category: "aura-ambient", description: "Brightly coloured rain around subject",
    promptHint: "vivid brightly coloured raindrops or pigment streams fall around the subject from above, splashing on the ground and forming pools of saturated colour, the subject untouched by the cascade" },
  { id: "saint-glow",           label: "Saint Glow",             category: "aura-ambient", description: "Halo and divine glow around subject",
    promptHint: "a soft golden halo glows behind the subject's head and warm celestial light radiates outward from the body, with faint dust motes drifting in the beams in a saintly halation" },
  { id: "fire-aura",            label: "Fire Aura",              category: "aura-ambient", description: "Flames lick around subject's body",
    promptHint: "flames lick and curl around the subject's body without burning them, the fire wrapping the silhouette in a halo of orange and yellow tongues with heat-haze distortion in the air around" },
  { id: "frost-aura",           label: "Frost Aura",             category: "aura-ambient", description: "Frost and ice radiate from subject",
    promptHint: "frost and ice radiate outward from the subject — surfaces around them rapidly icing over with crystalline patterns, breath visible in the cold air, faint blue-white snowflakes drifting" },
  { id: "shadow-aura",          label: "Shadow Aura",            category: "aura-ambient", description: "Dark shadow tendrils swirl around subject",
    promptHint: "dark shadow tendrils swirl and writhe around the subject's body, the surrounding light dimming as the inky aura coils outward from the silhouette in slow undulating motion" },
  { id: "electricity-aura",     label: "Electricity Aura",       category: "aura-ambient", description: "Tesla-coil electric arcs around subject",
    promptHint: "bright blue-white electric arcs crackle around the subject's body in branching tesla-coil patterns, jumping between extremities and the surrounding air with rhythmic strobing flashes" },
  { id: "sparkles-around",      label: "Magical Sparkles",       category: "aura-ambient", description: "Magical sparkles orbit the subject",
    promptHint: "delicate magical sparkles and small star-shaped particles orbit and trail around the subject's body in slow-motion arcs, leaving faint light streaks in their path" },
  { id: "fairies-around",       label: "Fairies Around",         category: "aura-ambient", description: "Tiny glowing fairies flutter around subject",
    promptHint: "tiny glowing fairies with translucent wings flutter around the subject in playful loops, each fairy leaving a faint trail of pixie-dust shimmer in their wake" },
  { id: "objects-orbit",        label: "Objects Orbit",          category: "aura-ambient", description: "Small objects float and orbit the subject",
    promptHint: "small objects relevant to the subject — books, tools, fruits, gemstones — rise from the ground and orbit slowly around them in concentric rings of unsupported flight" },
  { id: "petals-around",        label: "Petals Around",          category: "aura-ambient", description: "Cherry blossom petals drift around subject",
    promptHint: "soft cherry blossom petals drift gently around the subject from above, the petals catching in their hair and clothing in slow-motion pink-rose flurry" },
  { id: "glow-trace",           label: "Glow Trace",             category: "aura-ambient", description: "Light trails follow subject's motion",
    promptHint: "bright luminous trails follow every motion of the subject's body — limbs leaving glowing afterimage streaks that fade slowly behind, creating ribbons of light tracing the choreography" },
  { id: "tattoo-animation",     label: "Tattoo Animation",       category: "aura-ambient", description: "Tattoos glow and animate on skin",
    promptHint: "tattoos on the subject's skin begin to glow with internal light and the linework animates in slow motion — scenes within the tattoos visibly moving, ink shifting position across the body" },
]

export const CHARACTER_FX_CATEGORY_ORDER: ReadonlyArray<CharacterFxCategory> = [
  "transformation", "power", "body-mod", "face-expression", "aura-ambient",
]

export const CHARACTER_FX_CATEGORY_LABELS: Readonly<Record<CharacterFxCategory, string>> = {
  "transformation":  "Transformation",
  "power":           "Power & Ability",
  "body-mod":        "Body Modification",
  "face-expression": "Face & Expression",
  "aura-ambient":    "Aura & Ambient",
}

const characterFxById = new Map<string, CharacterFx>(
  CHARACTER_FX.map((c) => [c.id, c]),
)

export function getCharacterFx(id: string | undefined | null): CharacterFx | undefined {
  if (!id) return undefined
  return characterFxById.get(id)
}

export function getCharacterFxLabel(id: string | undefined | null, fallback?: string): string {
  const c = getCharacterFx(id)
  if (c) return c.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getCharacterFxPromptHint(id: string | undefined | null): string {
  return getCharacterFx(id)?.promptHint ?? ""
}

export const CHARACTER_FX_IDS: ReadonlyArray<string> = CHARACTER_FX.map((c) => c.id)

// ---------------------------------------------------------------------------
// Graph-aware composer — target input handle + timing fields + multi-pick
// ---------------------------------------------------------------------------

const POSITION_CLAUSES: Record<Exclude<CharacterFxPosition, "auto">, string> = {
  start:  "the effect occurs at the opening of the clip",
  middle: "the effect occurs in the middle of the clip",
  end:    "the effect occurs at the end of the clip",
  full:   "the effect persists for the entire clip",
}

const DURATION_CLAUSES: Record<Exclude<CharacterFxDuration, "auto">, string> = {
  instant: "manifesting instantaneously",
  short:   "manifesting over approximately 1 second",
  medium:  "manifesting over approximately 2 seconds",
  long:    "manifesting over approximately 3 seconds",
}

const INTENSITY_CLAUSES: Record<Exclude<CharacterFxIntensity, "auto">, string> = {
  subtle:  "with subtle restrained energy and minimal flourish",
  natural: "with natural unhurried timing",
  dynamic: "with dynamic energy and assertive flourish",
  crazy:   "with extreme exaggerated energy, wild flourishes, and dramatic distortion",
}

/**
 * Compose a character-fx prompt-hint sentence from an effect id (or array
 * of 1-2 ids for multi-pick) plus target-ref display names (from upstream
 * character/face/object/location nodes wired to the `target` handle) plus
 * optional timing fields.
 *
 * Substitution: each base hint has every `"the subject"` occurrence
 * rewritten to the target name BEFORE the join. Empty targetHints leaves
 * "the subject" intact in the prompt.
 */
export function composeCharacterFxHintFromConnections(
  effectId: string | ReadonlyArray<string> | undefined,
  targetHints: ReadonlyArray<string>,
  timing?: CharacterFxTiming,
): string {
  const ids = Array.isArray(effectId)
    ? Array.from(new Set(effectId)).slice(0, 2)
    : effectId ? [effectId] : []
  const baseHints = ids.map(getCharacterFxPromptHint).filter((h) => h.length > 0)
  if (baseHints.length === 0) return ""

  const targetClause = targetHints.filter((h) => h && h.length > 0).join(" and ")
  const substituted = targetClause
    ? baseHints.map((b) => b.replace(/\bthe subject\b/g, targetClause))
    : baseHints

  const combinedBase = substituted.join(", and ")
  const parts: string[] = [combinedBase]

  if (timing?.position  && timing.position  !== "auto") parts.push(POSITION_CLAUSES [timing.position])
  if (timing?.duration  && timing.duration  !== "auto") parts.push(DURATION_CLAUSES [timing.duration])
  if (timing?.intensity && timing.intensity !== "auto") parts.push(INTENSITY_CLAUSES[timing.intensity])

  return parts.join(", ")
}
