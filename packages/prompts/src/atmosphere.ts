/**
 * Canonical catalog of atmosphere / environmental effects.
 *
 * Atmosphere dimension of a shot — environmental elements in the air that
 * affect visibility and mood (rain, fog, god rays, particles). Independent
 * of lighting (color/direction of light) and color/look (post-processing
 * tone). A sunny scene with fog has different atmosphere than a clear sunny
 * scene, even with identical subject, lighting and color grade.
 *
 * Shared between the picker UI and the prompt-hint injection on both the
 * frontend DAG executor and the backend orchestrator.
 */

import { resolveTerm } from "./term.js"

export interface Atmosphere {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
  /**
   * Compact professional term for this atmosphere ("dense fog", "sparks and
   * embers") — authored only where the lowercased label is not what a DP or
   * VFX supervisor would write in a prompt. See `term.ts`.
   */
  readonly term?: string
}

export const ATMOSPHERES: ReadonlyArray<Atmosphere> = [
  { id: "clear",           label: "Clear",           description: "Clean, no atmospheric effect",             promptHint: "clear atmosphere, clean visibility with no fog or particles", term: "clear atmosphere" },
  { id: "cloudy",          label: "Cloudy",          description: "Partial cloud cover, mixed light",         promptHint: "cloudy atmosphere, partial cloud cover with mixed direct and diffused light, soft contrast and intermittent shadows", term: "cloudy sky" },
  { id: "overcast",        label: "Overcast",        description: "Uniform gray cloud cover",                 promptHint: "overcast atmosphere, uniform gray cloud cover with diffused flat light", term: "overcast sky" },
  { id: "fog",             label: "Fog",             description: "Dense low-visibility fog",                 promptHint: "dense fog atmosphere, thick low-visibility moisture obscuring all but the nearest subject, muted desaturated tones", term: "dense fog" },
  { id: "mist",            label: "Mist",            description: "Thin diffusing mist",                      promptHint: "light mist atmosphere, thin atmospheric haze gently diffusing distant elements while keeping the subject crisp", term: "light mist" },
  { id: "fog-mist",        label: "Fog / Mist",      description: "Soft diffusing fog",                       promptHint: "foggy atmosphere, soft mist reducing visibility and diffusing distant elements", term: "soft fog and mist" },
  { id: "light-rain",      label: "Light Rain",      description: "Soft falling rain",                        promptHint: "light rain falling softly, subtle droplets visible in the air with wet surfaces" },
  { id: "heavy-rain",      label: "Heavy Rain",      description: "Heavy storm with sheets of rain",          promptHint: "heavy rainstorm, dense sheets of rain with visible droplets and splashing surfaces" },
  { id: "storm",           label: "Storm",           description: "Violent thunderstorm with rain + lightning", promptHint: "stormy atmosphere, violent thunderstorm with sheeting rain, dramatic dark clouds, flickering lightning illuminating the scene, and wind-driven debris", term: "thunderstorm" },
  { id: "snow",            label: "Snow",            description: "Falling snowflakes",                       promptHint: "falling snow, snowflakes drifting through the air and accumulating on surfaces", term: "falling snow" },
  { id: "blizzard",        label: "Blizzard",        description: "Violent snowstorm, near whiteout",         promptHint: "blizzard atmosphere, violent snowstorm with horizontal wind-driven snow, near-whiteout visibility, deep accumulation on every surface" },
  { id: "dust",            label: "Dust",            description: "Dust particles in air",                    promptHint: "dusty atmosphere, visible airborne dust particles catching light and softening distant elements", term: "airborne dust" },
  { id: "god-rays",        label: "God Rays",        description: "Sun shafts through haze",                  promptHint: "visible volumetric god rays, sun shafts cutting through hazy atmosphere" },
  { id: "smoke",           label: "Smoke",           description: "Drifting smoke",                           promptHint: "drifting smoke in the scene, hazy volumetric smoke partially obscuring the subject", term: "drifting smoke" },
  { id: "bokeh-particles", label: "Bokeh Particles", description: "Floating out-of-focus specks",             promptHint: "floating bokeh particles in the air, out-of-focus glowing specks adding ambient depth" },
  { id: "chalk-dust",      label: "Chalk Dust",      description: "Soft chalk dust hanging in the air",       promptHint: "soft chalk dust haze suspended in the air, fine pale powder catching light with a classroom-like quality" },
  { id: "falling-petals",  label: "Falling Petals",  description: "Drifting flower petals",                   promptHint: "delicate flower petals drifting through the frame, cherry-blossom or rose petals tumbling slowly on a soft breeze" },
  { id: "confetti",        label: "Confetti",        description: "Colorful confetti falling",                promptHint: "colorful confetti raining through the frame, bright paper flecks tumbling and twirling against the background" },
  { id: "sparks-embers",   label: "Sparks / Embers", description: "Glowing embers drifting upward",           promptHint: "glowing sparks and embers drifting upward through the air, hot orange specks trailing faint motion against darker surroundings", term: "sparks and embers" },
  { id: "lens-flare",      label: "Lens Flare",      description: "Anamorphic flare streak across frame",     promptHint: "anamorphic horizontal lens flare streaking across the frame, cinematic light artifact with subtle ghosting and bloom", term: "anamorphic lens flare" },
  { id: "heat-haze",       label: "Heat Haze",       description: "Visible heat shimmer warping background",  promptHint: "visible heat shimmer rising in the scene, warping and rippling the background with refracted air distortion" },
  { id: "steam",           label: "Steam",           description: "Rising white steam",                       promptHint: "soft white steam rising through the frame, warm vapor curling upward from a hot surface and catching ambient light", term: "rising steam" },
  { id: "bubbles-underwater", label: "Underwater Bubbles", description: "Rising bubbles in water",            promptHint: "streams of bubbles rising through water, clear underwater spheres drifting upward with shifting refractive light" },
  { id: "rain-on-glass",   label: "Rain on Glass",   description: "Droplets streaking foreground glass",      promptHint: "raindrops beading and streaking down a foreground window pane, distorting the view behind with soft refracted detail" },
  { id: "pollen-light",    label: "Pollen in Light", description: "Warm particles in a sunbeam",              promptHint: "warm pollen and floating particles caught in a beam of sunlight, glowing motes drifting lazily through a shaft of light", term: "sunlit pollen motes" },
  { id: "water-droplets",  label: "Water Droplets",  description: "Droplets clinging to skin or surface",     promptHint: "fine water droplets clinging to skin and surfaces, fresh post-shower wetness with small beads catching highlights", term: "water droplets on skin" },
  { id: "falling-ash",     label: "Falling Ash",     description: "Fine grey ash drifting through the air",  promptHint: "fine grey ash drifting slowly through the air, weightless flakes settling across the scene with a quiet post-fire mood" },
  { id: "fireflies",       label: "Fireflies",       description: "Drifting bioluminescent specks",           promptHint: "fireflies drifting in soft warm pulses through the scene, summer-night magic glinting in the air with bioluminescent specks" },
  { id: "incense-smoke",   label: "Incense Smoke",   description: "Slow rising thick incense smoke",          promptHint: "thick incense smoke rising slowly through the frame, spiritual temple atmosphere with dust-lit shafts curling upward" },
  { id: "cigarette-smoke", label: "Cigarette Smoke", description: "Exhaled smoke curling upward",             promptHint: "exhaled cigarette smoke curling upward through the frame, café noir mood with thin pale plumes drifting against ambient light" },
  { id: "candle-glow",     label: "Candle-Glow",     description: "Warm flame light with soft halo",          promptHint: "warm candle flame casting a soft glowing halo across the scene, intimate vigil-like atmosphere with flickering golden light pooling around the source", term: "candlelight glow" },
  { id: "glitter-sparkle", label: "Glitter / Sparkle", description: "Sparkly particles in air",              promptHint: "sparkly glitter particles suspended in the air, party-disco atmosphere with tiny points of light catching and reflecting across the scene", term: "floating glitter particles" },
  { id: "starfield",       label: "Starfield / Visible Stars", description: "Visible night sky with stars", promptHint: "visible starfield filling the night sky, milky way and countless points of light spread across a vast cosmic backdrop", term: "visible starfield" },
  { id: "dandelion-seeds", label: "Dandelion Seeds", description: "Drifting dandelion fluff",                 promptHint: "dandelion seed fluff drifting on a soft summer breeze, ethereal whitish parachutes floating weightlessly through the frame with whimsical magic", term: "drifting dandelion seeds" },
  { id: "pollen-drift",    label: "Pollen Drift",    description: "Fine yellow-gold pollen in golden light", promptHint: "fine yellow-gold pollen drifting through golden hour light, warm dust motes suspended in slanted sunbeams across the scene", term: "drifting golden pollen" },
  { id: "snowflakes-heavy", label: "Heavy Snowfall", description: "Heavy thick snowflakes filling the air, blizzard", promptHint: "heavy thick snowflakes filling the air in a near-blizzard, dense flurries blowing across the frame and accumulating rapidly on every surface" },
  { id: "snowflakes-light", label: "Light Snow Drift", description: "Sparse drifting snowflakes, calm winter scene", promptHint: "sparse snowflakes drifting lazily through a calm winter scene, occasional flakes catching ambient light against a quiet hushed atmosphere", term: "light drifting snow" },
  { id: "raindrops-on-skin", label: "Raindrops on Skin", description: "Visible water droplets beading on skin and hair", promptHint: "visible water droplets beading on skin and hair, fresh rain catching highlights with rivulets tracing down cheeks and damp strands clinging to the face" },
  { id: "bioluminescent-cloud", label: "Bioluminescent Particle Cloud", description: "Glowing blue-green bioluminescent particles drifting like sea sparkle", promptHint: "glowing blue-green bioluminescent particles drifting through the air like sea sparkle, ethereal cyan motes pulsing softly with their own light against a darkened backdrop" },
  { id: "motion-streaks",  label: "Motion Streaks",  description: "Speed-line motion-blur streaks suggesting fast movement", promptHint: "speed-line motion-blur streaks slicing across the frame, smeared light trails and directional blur suggesting fast movement through the scene", term: "motion blur streaks" },
] as const

const atmosphereById = new Map<string, Atmosphere>(ATMOSPHERES.map((a) => [a.id, a]))

export function getAtmosphere(id: string | undefined | null): Atmosphere | undefined {
  if (!id) return undefined
  return atmosphereById.get(id)
}

export function getAtmosphereLabel(id: string | undefined | null, fallback?: string): string {
  const a = getAtmosphere(id)
  if (a) return a.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getAtmospherePromptHint(id: string | undefined | null): string {
  return getAtmosphere(id)?.promptHint ?? ""
}

/**
 * Compact counterpart of `getAtmospherePromptHint`: the short professional
 * term this atmosphere injects in compact hint mode ("dense fog" where the
 * hint is the full sentence). Empty string for an unknown id and for any
 * entry that injects no hint at all.
 */
export function getAtmosphereTerm(id: string | undefined | null): string {
  return resolveTerm(getAtmosphere(id))
}

/**
 * Multi-pick: 1-2 atmosphere ids → composite atmospheric clause. Single →
 * entry's own promptHint. Two → emit independently and join — atmospheres
 * are particle-effect descriptions that compose naturally
 * ("fog drifting in soft cool clouds, with golden god-rays cutting through").
 */
export function buildAtmosphereHints(value: unknown): string[] {
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  const out: string[] = []
  for (const id of ids) {
    const hint = getAtmospherePromptHint(id)
    if (hint) out.push(hint)
  }
  return out
}

/**
 * Compact counterpart of `buildAtmosphereHints`: the same 1-2 id multi-pick,
 * emitted as short professional terms instead of full mechanism sentences
 * ("dense fog", "god rays"). Same collection order, same skip-the-no-ops
 * behavior.
 */
export function buildAtmosphereTerms(value: unknown): string[] {
  const ids: string[] = []
  if (typeof value === "string" && value) ids.push(value)
  else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  const out: string[] = []
  for (const id of ids) {
    const term = getAtmosphereTerm(id)
    if (term) out.push(term)
  }
  return out
}

export const ATMOSPHERE_IDS: ReadonlyArray<string> = ATMOSPHERES.map((a) => a.id)
