/**
 * Canonical catalog of Action FX choices.
 *
 * Action FX describes a discrete, dramatic, high-energy event happening in the
 * scene — an explosion mid-blast, a lightning bolt striking, an earthquake
 * fracturing the ground, a magic fireball spell, a force field shimmering.
 *
 * Distinct from:
 *  - Atmosphere — continuous environmental state (rain, fog, smoke, dust).
 *  - Composition Effects — how the subject itself is rendered (smoke
 *    sculpture, exploding-particle silhouette, glitch).
 *  - Post-Process Effects — image-grading passes (vignette, grain, halation).
 *  - Color Look — overall color grade direction.
 *
 * Multi-pick: 1–2 ids → composite FX clause. Pure prompt text, zero credits,
 * zero API calls. Shared between picker UI and prompt-hint injection on
 * frontend DAG executor + backend orchestrator.
 */

export type ActionFxCategory =
  | "disaster"
  | "fire-blasts"
  | "electric"
  | "combat"
  | "sci-fi"
  | "magic"

export interface ActionFx {
  readonly id: string
  readonly label: string
  readonly category: ActionFxCategory
  readonly description: string
  readonly promptHint: string
}

export const ACTION_FX_CATEGORY_ORDER: ReadonlyArray<ActionFxCategory> = [
  "disaster",
  "fire-blasts",
  "electric",
  "combat",
  "sci-fi",
  "magic",
] as const

export const ACTION_FX_CATEGORY_LABELS: Readonly<Record<ActionFxCategory, string>> = {
  disaster: "Disaster",
  "fire-blasts": "Fire & Blasts",
  electric: "Electric",
  combat: "Combat",
  "sci-fi": "Sci-Fi",
  magic: "Magic",
} as const

export const ACTION_FX: ReadonlyArray<ActionFx> = [
  // ── Disaster ──
  { id: "earthquake-tremor",    category: "disaster", label: "Earthquake Tremor",    description: "Mild ground shake, hanging objects sway",
    promptHint: "a mild earthquake tremor rippling through the scene, hanging objects swaying gently and dust shaking loose from surfaces with a faint trembling motion across the frame" },
  { id: "earthquake-major",     category: "disaster", label: "Major Earthquake",     description: "Ground splitting, debris falling",
    promptHint: "a major earthquake violently shaking the scene, ground splitting open with deep cracks radiating outward and chunks of debris tumbling from above as everything trembles" },
  { id: "building-collapse",    category: "disaster", label: "Building Collapse",    description: "Structure crumbling mid-fall",
    promptHint: "a building collapsing mid-fall, walls buckling and concrete fragmenting outward in a cascade of debris with billowing dust clouds rolling out from the base of the structure" },
  { id: "tsunami-wave",         category: "disaster", label: "Tsunami Wave",         description: "Towering wall of water bearing down",
    promptHint: "a towering tsunami wave bearing down on the scene, wall of dark churning water curling overhead with white foam crests and debris carried inside the surge" },
  { id: "tornado",              category: "disaster", label: "Tornado",              description: "Funnel cloud touching down",
    promptHint: "a massive tornado funnel cloud touching down in the scene, dark spiraling vortex tearing across the landscape with debris ripped into the air and a trailing dust cloud at its base" },
  { id: "hurricane",            category: "disaster", label: "Hurricane",            description: "Howling winds bending trees, sheets of rain",
    promptHint: "a hurricane raging through the scene, howling sideways winds bending trees and palm fronds nearly horizontal, sheets of driving rain blurring the air with debris airborne in every direction" },
  { id: "blizzard-whiteout",    category: "disaster", label: "Blizzard Whiteout",    description: "Heavy snow obliterating visibility",
    promptHint: "a blinding blizzard whiteout consuming the scene, near-zero visibility through dense windswept snowfall and howling drifts that bury everything under a roaring white veil" },
  { id: "sandstorm",            category: "disaster", label: "Sandstorm",            description: "Wall of orange dust engulfing scene",
    promptHint: "a towering sandstorm wall of orange-brown dust engulfing the scene, swirling fine particles reducing visibility to feet and burying surfaces under shifting waves of grit" },
  { id: "dust-storm-haboob",    category: "disaster", label: "Dust Storm (Haboob)",  description: "Towering desert dust front",
    promptHint: "a towering haboob dust storm rolling across the scene, mountainous wall of dense ochre dust front billowing forward and swallowing the horizon in a dramatic monolithic curtain" },
  { id: "wildfire-distant",     category: "disaster", label: "Distant Wildfire",     description: "Orange glow + smoke on horizon",
    promptHint: "a distant wildfire raging on the horizon, orange-red glow lighting up dark plumes of smoke billowing into a hazy sky with embers visible at the treeline" },
  { id: "wildfire-engulfing",   category: "disaster", label: "Engulfing Wildfire",   description: "Flames closing in, intense heat shimmer",
    promptHint: "an engulfing wildfire closing in on the scene, walls of orange flame consuming nearby trees with intense heat shimmer warping the air and embers spiraling upward into a smoke-darkened sky" },
  { id: "volcanic-eruption",    category: "disaster", label: "Volcanic Eruption",    description: "Lava spewing, ash plume",
    promptHint: "a volcanic eruption with molten lava spewing skyward and a towering ash plume billowing into the atmosphere, glowing orange streams cascading down the slope and pyroclastic clouds rolling outward" },
  { id: "lava-flow",            category: "disaster", label: "Lava Flow",            description: "Glowing molten river creeping across ground",
    promptHint: "a glowing molten lava flow creeping across the ground, bright orange-red rivers of fire snaking through cooled black crust with shimmering heat distortion above and wisps of sulfurous smoke" },
  { id: "ash-rain",             category: "disaster", label: "Falling Ash Rain",     description: "Apocalyptic grey ash falling like snow",
    promptHint: "thick grey volcanic ash falling like dirty snow across the scene, apocalyptic post-eruption atmosphere with fine flakes settling on every surface and a hazy desaturated sky" },
  { id: "avalanche",            category: "disaster", label: "Avalanche",            description: "Wall of snow tumbling down mountainside",
    promptHint: "a massive avalanche tumbling down a mountainside, wall of churning snow and ice cascading at speed with a billowing powder cloud rolling forward and crushing everything in its path" },
  { id: "hailstorm",            category: "disaster", label: "Hailstorm",            description: "Large hailstones bouncing off surfaces",
    promptHint: "a violent hailstorm pummeling the scene, large hailstones bouncing off surfaces and shattering glass with white streaks of falling ice cutting through dark stormy clouds" },
  // ── Fire & Blasts ──
  { id: "explosion-small",      category: "fire-blasts", label: "Small Explosion",      description: "Compact blast with focal flash",
    promptHint: "a compact small explosion with a sharp focal flash, contained orange fireball expanding outward with a shockwave of dust and a brief plume of smoke rising directly above" },
  { id: "explosion-large",      category: "fire-blasts", label: "Large Explosion",      description: "Vehicle-scale fireball with debris",
    promptHint: "a large explosion at vehicle scale, churning fireball of orange and yellow flames expanding outward with debris hurled into the air and a thick black smoke crown billowing skyward" },
  { id: "explosion-massive",    category: "fire-blasts", label: "Massive Explosion",    description: "Building-leveling fireball with shockwave",
    promptHint: "a massive explosion erupting in the scene with a building-leveling fireball, dense orange-red flame core expanding outward and a visible shockwave displacing dust and debris in a radial blast" },
  { id: "nuclear-detonation",   category: "fire-blasts", label: "Nuclear Detonation",   description: "Mushroom cloud + horizon-bright flash",
    promptHint: "a nuclear detonation flashing on the horizon, blinding white core followed by a towering mushroom cloud column rising into the upper atmosphere with concentric shockwave ripples and an apocalyptic glow lighting the entire landscape" },
  { id: "fireball-airborne",    category: "fire-blasts", label: "Airborne Fireball",    description: "Mid-air rolling ball of flame",
    promptHint: "an airborne fireball rolling through mid-air, churning sphere of orange-red flame with trailing smoke streamers and a halo of heat distortion warping the surrounding light" },
  { id: "gas-explosion",        category: "fire-blasts", label: "Gas Explosion",        description: "Bright propane-style burst",
    promptHint: "a propane gas explosion bursting outward, bright bluish-orange flash at the core fading into a radiating fireball with the distinctive sharp flame profile and glass shattering at the periphery" },
  { id: "oil-fire",             category: "fire-blasts", label: "Oil Fire",             description: "Tall greasy flames + thick black smoke",
    promptHint: "an oil fire burning in the scene, tall greasy orange flames licking upward with dense roiling black smoke pouring into the sky and a hellish heat shimmer obscuring the background" },
  { id: "blazing-inferno",      category: "fire-blasts", label: "Blazing Inferno",      description: "Wall of fire consuming everything",
    promptHint: "a blazing inferno consuming the scene, wall of roaring orange flames climbing every surface with thick black smoke pouring upward and embers swirling in the convection currents above" },
  { id: "flame-burst",          category: "fire-blasts", label: "Flame Burst",          description: "Quick directional jet of flame",
    promptHint: "a directional flame burst shooting through the scene, sharp jet of orange-yellow fire projecting forward like a flamethrower stream with trailing smoke and visible heat warping the air behind it" },
  { id: "ember-shower",         category: "fire-blasts", label: "Ember Shower",         description: "Cascade of glowing orange embers",
    promptHint: "a dramatic ember shower cascading through the scene, glowing orange and gold embers tumbling and drifting through the air like fiery snowfall with trails of smoke and ash" },
  { id: "smoke-pillar",         category: "fire-blasts", label: "Smoke Pillar",         description: "Tall vertical column of black smoke",
    promptHint: "a tall vertical column of dense black smoke rising into the sky, twisting upward with internal turbulence and a faint orange glow at the base hinting at flames below" },
  { id: "mushroom-cloud",       category: "fire-blasts", label: "Mushroom Cloud",       description: "Classic dome-and-stem detonation cloud",
    promptHint: "a classic mushroom cloud rising in the distance, dome-and-stem detonation column with internal orange glow and turbulent grey-brown smoke swirling outward at the cap" },
  // ── Electric ──
  { id: "lightning-bolt",            category: "electric", label: "Lightning Bolt",            description: "Branching strike across stormy sky",
    promptHint: "a brilliant lightning bolt forking across a dark stormy sky, blinding white-blue branching arcs cutting through the clouds with a momentary illumination of the surrounding scene" },
  { id: "lightning-strike-impact",   category: "electric", label: "Lightning Strike Impact",   description: "Bolt hitting the ground with explosion of light",
    promptHint: "a lightning bolt striking the ground in the scene, blinding white-blue column of electricity slamming into a surface with a radial burst of light, scattering sparks and a thunderclap shockwave displacing nearby dust" },
  { id: "lightning-storm",           category: "electric", label: "Lightning Storm",           description: "Multiple simultaneous strikes",
    promptHint: "a violent lightning storm with multiple simultaneous strikes branching across the heavens, several jagged white-blue bolts forking down from low clouds and lighting the whole scene in stark intermittent flashes" },
  { id: "ball-lightning",            category: "electric", label: "Ball Lightning",            description: "Glowing orb of electric plasma floating mid-air",
    promptHint: "a rare ball lightning phenomenon floating in mid-air, glowing blue-white orb of electric plasma drifting slowly with crackling tendrils of energy spitting outward and a faint hum implied by visible field distortion" },
  { id: "plasma-arc",                category: "electric", label: "Plasma Arc",                description: "High-voltage continuous arc between two points",
    promptHint: "a continuous high-voltage plasma arc crackling between two points in the scene, white-violet electric current branching and writhing with intense glow and small showers of sparks at each terminal" },
  { id: "taser-sparks",              category: "electric", label: "Taser Sparks",              description: "Compact crackling electric discharge on contact",
    promptHint: "a compact taser-style electric discharge crackling on contact, bright blue-white sparks branching outward in a small radial spray with sharp little arcs jumping between contact points" },
  { id: "electric-discharge",        category: "electric", label: "Electric Discharge",        description: "Burst of arcing energy from a malfunctioning device",
    promptHint: "a sudden electric discharge bursting from a malfunctioning device, branching arcs of blue-white current spraying outward with showers of sparks and faint smoke trails curling from blackened contact points" },
  { id: "transformer-blowout",       category: "electric", label: "Transformer Blowout",       description: "Blue-white explosion atop a power pole",
    promptHint: "a transformer blowout atop a power pole, brilliant blue-white explosion of electric energy with showers of sparks raining downward and a brief mushroom of smoke followed by a blackout shadow falling across the scene" },
  { id: "st-elmos-fire",             category: "electric", label: "St. Elmo's Fire",           description: "Eerie blue plasma glow on metal extremities",
    promptHint: "an eerie St. Elmo's Fire phenomenon, soft blue-violet plasma glow flickering along metal extremities and pointed surfaces with a corona-like halo and faint crackling discharge" },
  { id: "static-shock-burst",        category: "electric", label: "Static Shock Burst",        description: "Tiny visible static-electricity zap",
    promptHint: "a small static shock burst visible at point of contact, tiny crackling blue-white spark jumping between two surfaces with a brief micro-arc of electricity and a hint of ozone-tinted air" },
  // ── Combat ──
  { id: "muzzle-flash",         category: "combat", label: "Muzzle Flash",         description: "Bright orange flash from gun barrel",
    promptHint: "a bright muzzle flash erupting from a gun barrel, sharp orange-yellow burst of light at the barrel tip with smoke trailing and the firearm in mid-recoil" },
  { id: "gunshot-impact",       category: "combat", label: "Gunshot Impact",       description: "Bullet hitting a surface with debris spray",
    promptHint: "a gunshot impact on a surface, sharp burst of debris spraying outward from the bullet hole with small fragments and dust scattering radially in the moment of strike" },
  { id: "bullet-trail",         category: "combat", label: "Bullet Trail",         description: "Visible bullet streak through air",
    promptHint: "a streaking bullet trail cutting through the air, thin bright tracer line accompanied by faint vapor wake suggesting hypersonic velocity and a sense of forward motion through the frame" },
  { id: "sword-spark",          category: "combat", label: "Sword Spark",          description: "Macro shower of metal-on-metal friction sparks",
    promptHint: "a macro close-up of bright sparks at the moment of metal-on-metal friction, white-hot incandescent flecks scattering radially with brief streaks of friction-light, captured at extreme close range with no swords or blades visible in the frame" },
  { id: "blade-clash",          category: "combat", label: "Blade Clash",          description: "Two blades meeting with impact wave",
    promptHint: "two blades clashing together at the moment of impact, sparks flying outward from the contact line and a brief shockwave of displaced air rippling around the steel edges" },
  { id: "ricochet-spark",       category: "combat", label: "Ricochet Spark",       description: "Bullet bouncing off metal with sparks",
    promptHint: "a bullet ricocheting off a metal surface, sharp burst of orange-white sparks at the deflection point with the bullet visibly trailing off at a new angle and a thin streak of vapor in its wake" },
  { id: "debris-field",         category: "combat", label: "Debris Field",         description: "Frozen mid-air shrapnel scattering",
    promptHint: "a debris field frozen in mid-air, fragments of wood, metal, and concrete scattering outward in a radial pattern from a central impact point with dust and smoke swirling among the larger pieces" },
  { id: "glass-shatter-airborne", category: "combat", label: "Airborne Glass Shatter", description: "Glass exploding outward in mid-air shards",
    promptHint: "a window or glass surface shattering outward in mid-air, hundreds of jagged crystalline shards exploding into the scene catching the light and tumbling in suspended chaos at the moment of impact" },
  { id: "shockwave-ground",     category: "combat", label: "Ground Shockwave",     description: "Visible expanding ring at ground level",
    promptHint: "a visible shockwave expanding at ground level, dust and small debris pushed outward in a clear radial ring from the impact origin with a momentary distortion in the air above" },
  { id: "sonic-boom",           category: "combat", label: "Sonic Boom",           description: "Cone of compressed air at supersonic speed",
    promptHint: "a sonic boom cone of compressed air visible around a supersonic object, vapor cone forming a sharp white halo with a trailing condensation cloud and a sense of audible thunder implied by the violent rippling distortion" },
  { id: "smoke-grenade",        category: "combat", label: "Smoke Grenade",        description: "Thick colored smoke blooming outward",
    promptHint: "a smoke grenade billowing colored smoke outward, thick clouds of dense vapor blooming in red-orange or grey rolling across the scene at low height and obscuring the background tactical-style" },
  { id: "flashbang",            category: "combat", label: "Flashbang",            description: "Blinding white-out burst of light",
    promptHint: "a flashbang detonation, intense blinding white-out burst of light filling the frame with a shockwave of compressed air and a fast-fading core of pure white at the explosion's center" },
  { id: "blood-spray",          category: "combat", label: "Blood Spray",          description: "Cinematic arc of blood droplets",
    promptHint: "a cinematic arc of blood droplets spraying outward in slow-motion, suspended red flecks tracing a curved path through the air with the dramatic stylized aesthetic of action cinema" },
  { id: "arrow-hit-spark",      category: "combat", label: "Arrow Hit Spark",      description: "Arrow striking with small sparks at impact",
    promptHint: "an arrow striking a surface with a small burst of sparks at the impact point, shaft quivering on contact and tiny incandescent flecks scattering outward from the arrowhead" },
  // ── Sci-Fi ──
  { id: "laser-blast",          category: "sci-fi", label: "Laser Blast",          description: "Bright coherent beam of energy",
    promptHint: "a bright coherent laser blast cutting through the scene, vivid red or green beam of focused energy with a glowing core and a halo of scattered light along its path" },
  { id: "energy-beam",          category: "sci-fi", label: "Energy Beam",          description: "Wide pulsing beam of plasma energy",
    promptHint: "a wide pulsing energy beam projecting forward, swirling plasma core wrapped in concentric pulses of light and a halo of bright glow saturating the surrounding atmosphere" },
  { id: "plasma-bolt",          category: "sci-fi", label: "Plasma Bolt",          description: "Glowing projectile leaving a vapor trail",
    promptHint: "a glowing plasma bolt streaking through the air, bright cyan or violet projectile with a trailing vapor wake and small radiating arcs of energy spitting from its surface" },
  { id: "force-field-shimmer",  category: "sci-fi", label: "Force Field Shimmer",  description: "Translucent hex-pattern energy barrier",
    promptHint: "a translucent hexagonal force field shimmering in the scene, faint blue-cyan energy panels rippling with electric edges and refracting whatever lies behind it" },
  { id: "force-field-impact",   category: "sci-fi", label: "Force Field Impact",   description: "Visible ripple where projectile hits shield",
    promptHint: "a force field absorbing an impact, visible ripple spreading outward from the strike point with hexagonal energy panels glowing brightly at the contact site and discharge arcs branching across the surface" },
  { id: "portal-opening",       category: "sci-fi", label: "Portal Opening",       description: "Swirling vortex of energy tearing open in space",
    promptHint: "a sci-fi portal tearing open in space, swirling vortex of bluish energy with edges flickering between dimensions and a glowing event horizon framing a glimpse of the destination beyond" },
  { id: "warp-distortion",      category: "sci-fi", label: "Warp Distortion",      description: "Spacetime bending around an object",
    promptHint: "a spacetime warp distortion bending the air around an object, light streaks curving inward and the background visibly stretched and refracted in the gravitational well of the effect" },
  { id: "hologram-flicker",     category: "sci-fi", label: "Hologram Flicker",     description: "Translucent projection glitching",
    promptHint: "a translucent holographic projection flickering and glitching in the scene, scanlines and chromatic noise distorting the cyan-blue figure with brief signal dropouts revealing the air behind it" },
  { id: "ion-storm",            category: "sci-fi", label: "Ion Storm",            description: "Crackling field of charged particles against a cosmic backdrop",
    promptHint: "a crackling ion storm filling the scene, field of charged particles flickering with ionized streamers and ribbons of plasma weaving through the air with auroral colors washing across the cosmic backdrop" },
  { id: "antimatter-flash",     category: "sci-fi", label: "Antimatter Flash",     description: "Reality-tearing burst of pure white energy",
    promptHint: "an antimatter annihilation flash, blinding burst of pure white energy radiating outward with the surrounding space appearing to tear and warp around the explosion's perfectly spherical core" },

  // ── Magic ──
  { id: "fireball-spell",       category: "magic", label: "Fireball Spell",       description: "Hand-cast orb of swirling fire",
    promptHint: "a hand-cast fireball spell, swirling orb of bright orange-red flame held mid-air with embers spinning around its surface and a halo of heat distortion warping the air at the caster's fingertips" },
  { id: "magic-aura",           category: "magic", label: "Magic Aura",           description: "Glowing energy halo around a figure",
    promptHint: "a glowing magic aura surrounding a figure, soft luminous halo of golden or violet energy radiating outward with shimmer particles drifting upward and faint runes hovering in the field" },
  { id: "summoning-glyph",      category: "magic", label: "Summoning Glyph",      description: "Glowing magical circle on the ground",
    promptHint: "a glowing summoning circle inscribed on the ground, intricate concentric runic glyphs blazing with golden light and pillars of energy rising from the perimeter to form a column of arcane power" },
  { id: "lightning-magic",      category: "magic", label: "Lightning Magic",      description: "Electric sorcery arcing from caster's hands",
    promptHint: "lightning magic arcing from a caster's outstretched hands, branching white-blue bolts of electric sorcery crackling forward with sparks spitting from fingertips and a halo of power glowing around the wrist" },
  { id: "ice-shard-burst",      category: "magic", label: "Ice Shard Burst",      description: "Crystalline shards spraying outward",
    promptHint: "a burst of crystalline ice shards spraying outward, dozens of jagged frozen splinters flying radially through cold mist with frost-blue refractive edges catching the light" },
  { id: "energy-rune",          category: "magic", label: "Energy Rune",          description: "Glowing arcane symbol hanging in the air",
    promptHint: "a glowing arcane energy rune hovering in the air, intricate symbolic geometry burning bright with golden or cyan light and a soft pulse of power emanating in concentric waves around the symbol" },
  { id: "portal-magic",         category: "magic", label: "Magic Portal",         description: "Swirling mystical doorway in space",
    promptHint: "a swirling mystical portal opening in space, ring of arcane fire encircling a vortex of dimensional energy with sparks swirling around the rim and a glimpse of an otherworldly realm visible through the opening" },
  { id: "healing-glow",         category: "magic", label: "Healing Glow",         description: "Warm golden light emanating from caster",
    promptHint: "a warm healing glow emanating from a caster's hands, gentle golden-white radiance spreading outward with motes of soft light drifting upward and a sense of restorative energy permeating the surrounding air" },
  { id: "dark-vortex",          category: "magic", label: "Dark Vortex",          description: "Ominous black-purple swirling void",
    promptHint: "an ominous dark vortex swirling in the scene, churning black-and-purple void with tendrils of shadow energy reaching outward and a sense of consuming power drawing light into its center" },
  { id: "light-explosion",      category: "magic", label: "Light Explosion",      description: "Burst of pure white-gold radiance",
    promptHint: "a brilliant explosion of pure white-gold radiance, divine burst of light radiating outward with rays of beam-light fanning across the scene and motes of golden particles suspended in the afterglow" },
] as const

export const ACTION_FX_IDS: ReadonlyArray<string> = ACTION_FX.map((fx) => fx.id)

const actionFxById = new Map<string, ActionFx>(ACTION_FX.map((fx) => [fx.id, fx]))

export function getActionFx(id: string | undefined | null): ActionFx | undefined {
  if (!id) return undefined
  return actionFxById.get(id)
}

export function getActionFxLabel(id: string | undefined | null, fallback?: string): string {
  const fx = getActionFx(id)
  if (fx) return fx.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getActionFxPromptHint(id: string | undefined | null): string {
  return getActionFx(id)?.promptHint ?? ""
}

/**
 * Multi-pick: 1–2 ids → composite FX clause.
 *
 * Single id → entry's own promptHint as a single-element array.
 * Two ids → emit each independently and let the comma-join compose them.
 * Caps at 2 ids (silently drops the rest); the picker UI also enforces this
 * cap, but the cap here keeps the contract robust against stale workflow
 * data. Duplicate ids are deduplicated before the cap is applied.
 */
export function buildActionFxHints(value: unknown): string[] {
  const ids: string[] = []
  if (typeof value === "string" && value) {
    ids.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v && !ids.includes(v)) {
        ids.push(v)
        if (ids.length >= 2) break
      }
    }
  }
  const hints: string[] = []
  for (const id of ids) {
    const hint = getActionFxPromptHint(id)
    if (hint) hints.push(hint)
  }
  return hints
}
