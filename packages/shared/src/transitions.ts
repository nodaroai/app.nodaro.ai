/**
 * Canonical catalog of cinematic transitions for AI-video generation.
 *
 * Shared between frontend (picker UI, prompt hint injection) and backend
 * (orchestrator payload builder). The `promptHint` is a natural-language
 * cue that gets composed into the user prompt when a transition node is
 * connected to a video consumer.
 *
 * Multi-pick supported: value field accepts `string | string[]` (cap 2).
 * Graph-aware: `startState` / `endState` input handles accept upstream
 * parameter nodes whose hints are folded into the composed clause as
 * "starting from <X>, ending at <Y>".
 */

export type TransitionCategory =
  | "standard"
  | "time"
  | "element"
  | "morph"
  | "portal"
  | "physics"
  | "light"
  | "glitch"

export interface Transition {
  readonly id: string
  readonly label: string
  readonly category: TransitionCategory
  readonly description: string
  readonly promptHint: string
}

export type TransitionPosition = "auto" | "start" | "middle" | "end" | "full"
export type TransitionDuration = "auto" | "instant" | "short" | "medium" | "long"
export type TransitionIntensity = "auto" | "subtle" | "natural" | "dynamic" | "crazy"

export interface TransitionTiming {
  position?: TransitionPosition
  duration?: TransitionDuration
  intensity?: TransitionIntensity
}

export const TRANSITIONS: ReadonlyArray<Transition> = [
  // ============================================================================
  // STANDARD — 11 entries — classical editing transitions
  // ============================================================================
  { id: "auto",              label: "Auto",              category: "standard", description: "Let the model choose", promptHint: "" },
  { id: "none",              label: "None / Hard Cut",   category: "standard", description: "Instantaneous switch, no transition",
    promptHint: "no transition, hard cut, instantaneous switch from first shot to second shot" },
  { id: "cross-dissolve",    label: "Cross-Dissolve",    category: "standard", description: "Gradual blend between shots",
    promptHint: "smooth cross-dissolve transition where the first shot gradually fades out as the second shot fades in" },
  { id: "fade-to-black",     label: "Fade to Black",     category: "standard", description: "Darkens to black, second emerges",
    promptHint: "fade to black: the first shot gradually darkens to full black, holds briefly, then the second shot fades up from black" },
  { id: "fade-to-white",     label: "Fade to White",     category: "standard", description: "Blooms to white, second emerges",
    promptHint: "fade to white: the first shot brightens until the frame is pure white, then the second shot resolves out of the white" },
  { id: "match-cut",         label: "Match Cut",         category: "standard", description: "Shape or motion match across shots",
    promptHint: "match cut: the final composition of the first shot matches the opening composition of the second shot in shape, color, and motion, so the cut feels like a visual rhyme" },
  { id: "smash-cut",         label: "Smash Cut",         category: "standard", description: "Jarring abrupt cut between contrasting shots",
    promptHint: "smash cut: an abrupt jarring transition between two visually or tonally contrasting shots with no fade, on a beat" },
  { id: "iris",              label: "Iris",              category: "standard", description: "Circular iris closes, then opens on second",
    promptHint: "iris transition: a circular vignette closes inward over the first shot until the frame is black, then opens outward to reveal the second shot" },
  { id: "wipe",              label: "Wipe",              category: "standard", description: "Linear wipe replaces first shot",
    promptHint: "linear wipe transition: a clean diagonal line sweeps across the frame, revealing the second shot behind it" },
  { id: "roll-transition",   label: "Roll",              category: "standard", description: "Frame rolls 90-180°, second shot upright on landing",
    promptHint: "the frame rolls along the camera axis with a smooth 90 to 180 degree rotation, motion-blurred during the roll, and as the rotation completes the new shot is upright and stable in frame" },
  { id: "seamless-match",    label: "Seamless Match",    category: "standard", description: "Hidden cut disguised by matched motion and color",
    promptHint: "hidden seamless transition: the camera motion, color palette, and on-screen motion at the end of the first shot continue exactly across the cut into the second shot, so the boundary is invisible and the two shots feel like one unbroken take" },

  // ============================================================================
  // TIME — 8 entries — temporal shifts (same or related scene, different time, or memory)
  // ============================================================================
  { id: "fast-forward-day-night",  label: "Fast-Forward (Day → Night)", category: "time", description: "Time-lapse day to night same scene",
    promptHint: "fast-forward time-lapse transition: the sun visibly arcs across the sky, shadows sweep, clouds streak, sky shifts from daylight blue through golden hour to deep night, stars emerge, all while framing and camera position remain locked on the same scene" },
  { id: "fast-forward-night-day",  label: "Fast-Forward (Night → Day)", category: "time", description: "Time-lapse night to dawn same scene",
    promptHint: "fast-forward time-lapse transition: stars fade, the sky shifts from deep night through pre-dawn blue to golden sunrise, shadows sweep in reverse, all while framing and camera position remain locked on the same scene" },
  { id: "seasonal-shift",          label: "Seasonal Shift",             category: "time", description: "Same scene through changing seasons",
    promptHint: "accelerated seasonal time-lapse: foliage transitions from spring green to summer lushness to autumn red-gold to winter bare, leaves fall and regrow, snow accumulates and melts, all within the same locked framing" },
  { id: "aging",                   label: "Aging",                      category: "time", description: "Subject visibly ages forward in time",
    promptHint: "accelerated aging transition: the subject visibly ages forward — skin develops fine lines then deeper wrinkles, hair lightens to silver, posture shifts subtly, while the framing holds steady on the face" },
  { id: "rewind",                  label: "Rewind",                     category: "time", description: "Time reverses, motion plays backward",
    promptHint: "rewind transition: time reverses and all motion plays smoothly backward, water flows up, debris reassembles, the subject's recent actions undo, with a faint VHS-rewind tracking distortion at the edges" },
  { id: "freeze-frame-jump",       label: "Freeze-Frame Jump",          category: "time", description: "Action freezes, jumps forward in time",
    promptHint: "freeze-frame transition: motion arrests mid-action, the frame holds frozen for a beat, then snaps to a new moment hours or days later in the same scene with subjects in different positions" },
  { id: "weather-shift",           label: "Weather Shift",              category: "time", description: "Same scene through changing weather",
    promptHint: "accelerated weather transition: same scene, framing locked — clear sky darkens to storm clouds, rain begins and intensifies then clears, sun returns through breaking clouds" },
  { id: "flashback",               label: "Flashback",                  category: "time", description: "Memory-flashback into a past moment of the subject",
    promptHint: "brief flashback transition: the frame washes with a soft warm or desaturated tint, faint ripple distortion crosses the image as the present scene fades, and a remembered earlier moment resolves into focus on the same subject" },

  // ============================================================================
  // ELEMENT — 14 entries — teleport via natural element
  // ============================================================================
  { id: "dissolve-to-mist",  label: "Dissolve to Mist",   category: "element", description: "Subject turns to mist, drifts, reforms",
    promptHint: "the subject gradually dissolves into a soft cloud of mist that swirls and drifts across the frame, then the mist re-condenses into the new subject in the new setting" },
  { id: "water-splash",      label: "Water Splash",       category: "element", description: "Subject becomes water, splashes, reforms",
    promptHint: "the subject liquefies into a cascade of water that splashes and pools, the water then surges upward and re-forms into the new subject in a new setting" },
  { id: "sand-scatter",      label: "Sand Scatter",       category: "element", description: "Subject becomes sand, blown away, reforms",
    promptHint: "the subject crumbles into fine sand that is swept away by a gust of wind in a swirling vortex, then the sand particles converge and re-form into the new subject" },
  { id: "fire-burnup",       label: "Burn-Up",            category: "element", description: "Subject burns to embers, embers reform",
    promptHint: "the subject ignites and burns from edges inward into glowing embers and ash, the embers swirl through the frame and re-ignite into the new subject" },
  { id: "smoke-puff",        label: "Smoke Puff",         category: "element", description: "Subject vanishes in smoke, reappears",
    promptHint: "the subject vanishes in a soft puff of smoke that billows outward and fills the frame, the smoke then clears to reveal the new subject in the new scene" },
  { id: "magic-sparkles",    label: "Magic Sparkles",     category: "element", description: "Particle dissolve à la Avengers / apparition",
    promptHint: "the subject disintegrates into a cloud of glowing golden sparkles that scatter outward, then the sparkles converge from across the frame and re-coalesce into the new subject" },
  { id: "lightning-flash",   label: "Lightning Strike",   category: "element", description: "Lightning strikes, scene changes in flash",
    promptHint: "a brilliant white lightning bolt cracks across the frame with a bright flash, and when the flash subsides the scene has changed to the new setting" },
  { id: "ink-splash",        label: "Ink Splash",         category: "element", description: "Ink splashes across, scene changes",
    promptHint: "black ink splashes across the frame in expanding tendrils that fully cover the image, then the ink retracts inward and pulls back to reveal the new scene" },
  { id: "sand-storm",        label: "Sand Storm",         category: "element", description: "Sand storm engulfs the frame, scene changes inside",
    promptHint: "a violent sand storm sweeps in from the side and engulfs the frame in opaque swirling ochre dust, and as the wind dies and the dust settles the second scene is revealed in the now-clear air" },
  { id: "paint-splash",      label: "Paint Splash",       category: "element", description: "Vivid paint splash covers, retracts into new scene",
    promptHint: "a vivid splash of colored paint hurls across the frame in arcing tendrils until it fully covers the image, then the paint flows and retracts inward to pull back and reveal the new scene" },
  { id: "aurora-sweep",      label: "Aurora Sweep",       category: "element", description: "Aurora curtain sweeps across, scene changes behind",
    promptHint: "a luminous green and violet aurora curtain ripples across the entire frame, the bright bands obscure the first scene, and as the aurora dissipates the second scene resolves in the clear sky" },
  { id: "sakura-petals",     label: "Sakura Storm",       category: "element", description: "Cherry blossom petals storm across the frame",
    promptHint: "a dense storm of cherry blossom petals swirls in from one side and fills the frame in soft pink motion, the petals cluster to fully veil the image, then drift past to reveal the new scene" },
  { id: "garden-bloom",      label: "Garden Bloom",       category: "element", description: "Flowers bloom outward, parting to reveal new scene",
    promptHint: "lush flowers and vines rapidly grow and bloom outward from the edges of the frame, the foliage spreads to overtake the entire image, then parts open like curtains to reveal the new scene behind" },
  { id: "powder-burst",      label: "Powder Burst",       category: "element", description: "Colored powder bursts across frame and clears",
    promptHint: "a burst of vivid colored powder explodes from the center of the frame in slow motion, the cloud of pigment expands to fill the image, then drifts apart and settles to reveal the second scene" },

  // ============================================================================
  // MORPH — 9 entries — continuous shape-shift
  // ============================================================================
  { id: "liquid-morph",      label: "Liquid Morph",       category: "morph", description: "Subject melts and reforms as new subject",
    promptHint: "smooth liquid morph: the first subject's surface becomes fluid and continuously deforms, flowing without breaks into the silhouette and details of the second subject" },
  { id: "pixelate-reform",   label: "Pixelate & Reform",  category: "morph", description: "Pixelates, scatters, reforms as new",
    promptHint: "the first subject pixelates into large mosaic blocks that scatter outward across the frame, then the blocks converge and resolve into the new subject" },
  { id: "shatter-glass",     label: "Shatter & Reform",   category: "morph", description: "Subject shatters like glass, reforms",
    promptHint: "the first subject shatters like glass into hundreds of shards that fly outward, then the shards reverse direction in reverse time and reassemble into the new subject" },
  { id: "origami-fold",      label: "Origami Fold",       category: "morph", description: "Subject folds like paper into new subject",
    promptHint: "the first subject creases and folds like sheets of origami paper, the folds rotate and re-arrange in elegant geometric steps, and the final fold reveals the new subject" },
  { id: "vortex-swirl",      label: "Vortex Swirl",       category: "morph", description: "Subject swirls into vortex, unwinds as new",
    promptHint: "the first subject spirals inward into a tight vortex at the center of the frame, the vortex briefly compresses to a point, then unwinds outward into the new subject" },
  { id: "dream-ripple",      label: "Dream Ripple",       category: "morph", description: "Surface ripple wave reveals new scene",
    promptHint: "a circular ripple radiates outward across the frame as if the image were the surface of water, and where the ripple passes the first scene is replaced by the second scene" },
  { id: "wireframe-morph",   label: "Wireframe Morph",    category: "morph", description: "Subject reduces to wireframe, reforms as new subject",
    promptHint: "the first subject's surface peels away to reveal a glowing geometric wireframe of polygons and edges, the wireframe flexes and re-tessellates into the topology of the new subject, then the new surface skins over the wireframe" },
  { id: "polygon-shatter",   label: "Polygon Shatter",    category: "morph", description: "Subject fragments into low-poly chunks, reassembles",
    promptHint: "the first subject fractures into low-polygon faceted chunks that explode outward in slow motion, the polygons then reverse course and re-assemble in clean geometric flight paths into the silhouette of the new subject" },
  { id: "melt-down",         label: "Melt Down",          category: "morph", description: "Subject melts into puddle, reforms as new",
    promptHint: "the first subject's form softens and melts downward like wax, collapsing into a glossy puddle on the ground, the puddle then surges upward and re-solidifies into the new subject standing in the new scene" },

  // ============================================================================
  // PORTAL — 10 entries — zoom-into-object world-jumps
  // ============================================================================
  { id: "zoom-into-eye",     label: "Zoom Into Eye",        category: "portal", description: "Push into pupil, new world inside",
    promptHint: "the camera pushes into a tight macro of the subject's eye, the pupil dilates and fills the frame, and the new scene materialises from within the pupil as if the pupil itself were a portal" },
  { id: "zoom-into-mirror",  label: "Zoom Into Mirror",     category: "portal", description: "Push into mirror, scene inside reflection",
    promptHint: "the camera pushes toward a mirror in the scene, the mirror's reflection fills the frame, and the camera passes through the mirror surface into the reflected world which becomes the new scene" },
  { id: "zoom-into-screen",  label: "Zoom Into Screen",     category: "portal", description: "Push into TV/phone screen",
    promptHint: "the camera pushes toward a screen visible in the scene (TV, phone, monitor), the screen's image fills the frame, and the camera passes through into that image which becomes the new scene" },
  { id: "zoom-into-book",    label: "Zoom Into Book",       category: "portal", description: "Push into book page illustration",
    promptHint: "the camera pushes down into an illustrated page in a book, the illustration grows to fill the frame, and the illustration comes alive as the new scene" },
  { id: "walk-through-door", label: "Walk Through Doorway", category: "portal", description: "Through doorway into new scene",
    promptHint: "the camera follows the subject through a doorway, and the space on the other side is the new scene — different location entirely, lit differently" },
  { id: "fall-into-hole",    label: "Fall Into Hole",       category: "portal", description: "Camera falls through opening",
    promptHint: "the floor or ground opens beneath the camera and the camera falls downward through the opening, tumbling, and emerges into the new scene below" },
  { id: "pull-out-reveal",   label: "Pull-Out Reveal",      category: "portal", description: "Reveals scene was a picture in larger context",
    promptHint: "the camera pulls back rapidly and reveals that the entire first scene was actually contained within a picture, painting, screen, or window in a larger second scene" },
  { id: "zoom-into-mouth",   label: "Zoom Into Mouth",      category: "portal", description: "Push into open mouth, emerges in new world inside",
    promptHint: "the camera pushes into the subject's open mouth, the dark interior fills the frame, and the camera passes through the throat into the new scene which materialises as if emerging from inside the body" },
  { id: "push-through-glass", label: "Push Through Glass",   category: "portal", description: "Camera pushes through pane of glass into new world",
    promptHint: "the camera pushes toward a pane of glass in the scene, the surface ripples like liquid as the camera passes through with a faint refraction, and the space on the other side resolves as the new scene" },
  { id: "soul-jump",         label: "Soul Jump",            category: "portal", description: "Translucent soul leaves body, enters new body",
    promptHint: "a translucent luminous form rises out of the first subject's body and shoots forward through the frame as a ghost-like soul, then dives into a new body in the new scene where the second subject animates to life" },

  // ============================================================================
  // PHYSICS — 9 entries — force-driven transitions
  // ============================================================================
  { id: "explosion-blast",   label: "Explosion Blast",    category: "physics", description: "Explosion wipes frame, new scene emerges",
    promptHint: "an explosion erupts from the center of the frame with a bright fireball that expands to fill the frame, and as the fireball dissipates the new scene is revealed" },
  { id: "shockwave",         label: "Shockwave",          category: "physics", description: "Shockwave ripples across, scene changes",
    promptHint: "a visible shockwave ripples outward across the frame distorting the image, and as the shockwave passes the scene behind it has changed to the new setting" },
  { id: "punch-into-camera", label: "Punch Into Camera",  category: "physics", description: "Fist strikes camera, scene changes",
    promptHint: "a fist or object swings rapidly toward the camera and strikes the lens with motion blur and impact frames, and the moment of impact reveals the new scene" },
  { id: "debris-shower",     label: "Debris Shower",      category: "physics", description: "Debris flies past, scene changes behind",
    promptHint: "a shower of debris — leaves, papers, dust — sweeps across the frame in front of the camera, and once the debris clears the scene behind has changed" },
  { id: "gravity-flip",      label: "Gravity Flip",       category: "physics", description: "Gravity inverts, camera rotates 180",
    promptHint: "gravity inverts and the camera rotates a full 180 degrees as objects and the subject reorient to the new down, settling into the new scene oriented correctly" },
  { id: "building-explosion", label: "Building Explosion", category: "physics", description: "Structure detonates, scene shifts through smoke",
    promptHint: "a large structure in the frame detonates with a massive fireball, debris and dust pluming outward to fill the image, and as the smoke clears the new scene is revealed where the structure used to stand" },
  { id: "vehicle-explosion", label: "Vehicle Explosion",  category: "physics", description: "Vehicle detonates in foreground, scene changes behind",
    promptHint: "a vehicle in the foreground erupts in a violent explosion of fire and twisted metal, the fireball expands toward the camera and washes the frame in orange flame, and as the smoke parts the second scene resolves" },
  { id: "jump-match",        label: "Jump Match",         category: "physics", description: "Subject jumps, landing matches into new scene",
    promptHint: "the subject jumps upward and out of frame at the end of the first shot, with matched velocity the camera follows the arc, and on landing the subject is in a new location seamlessly continuing the same jump" },
  { id: "hand-swipe",        label: "Hand Swipe",         category: "physics", description: "Hand swipes across lens, scene changes during occlusion",
    promptHint: "a hand sweeps across the camera lens at close range, fully occluding the frame in motion blur for a single beat, and as the hand exits the opposite side the scene has changed to the new setting" },

  // ============================================================================
  // LIGHT — 8 entries — flash and lens FX
  // ============================================================================
  { id: "white-flash",       label: "White Flash",        category: "light", description: "Frame blooms to white",
    promptHint: "a bright camera-flash bloom fills the frame with pure white, holds for a fraction of a second, then resolves into the new scene" },
  { id: "lens-flare-swipe",  label: "Lens Flare Swipe",   category: "light", description: "Anamorphic lens flare swipes",
    promptHint: "a horizontal anamorphic lens flare sweeps across the frame from one side to the other, and as it crosses the frame the scene behind it has changed to the new setting" },
  { id: "light-streak",      label: "Light Streak",       category: "light", description: "Light streak wipes across",
    promptHint: "a bright streak of light races across the frame leaving motion-blur trails, and as the streak exits the opposite side the scene is now the new setting" },
  { id: "color-invert",      label: "Color Invert Flash", category: "light", description: "Colors invert briefly",
    promptHint: "colors invert across the entire frame to their negative for a single beat, and when the colors snap back the scene has changed to the new setting" },
  { id: "sun-glare",         label: "Sun Glare",          category: "light", description: "Sun glare washes frame",
    promptHint: "intense sun glare overwhelms the lens with bright lens flares and bloom that wash out the frame, and as the glare dissipates the new scene resolves" },
  { id: "lens-crack",        label: "Lens Crack",         category: "light", description: "Lens cracks, scene through fractured glass",
    promptHint: "a hairline crack races diagonally across the camera lens with a sharp visual snap, multiple fracture lines branch outward, and the second scene resolves through the cracked glass before the fractures fade away" },
  { id: "dirty-lens-wipe",   label: "Dirty Lens Wipe",    category: "light", description: "Lens dust/grime wipes clean, scene changes",
    promptHint: "the camera lens is suddenly streaked with dust, water beads, and grime that swirl across the front element, a wiping motion sweeps the lens clean from one side to the other, revealing the new scene in crisp focus" },
  { id: "eye-light-burst",   label: "Eye Light Burst",    category: "light", description: "Bright beam from subject's eyes whites out frame",
    promptHint: "the subject's eyes ignite with a brilliant white beam of light that overpowers the frame in bloom and lens flares, the radiance fills the image entirely, and as the glow recedes the new scene is revealed" },

  // ============================================================================
  // GLITCH — 7 entries — digital corruption transitions
  // ============================================================================
  { id: "digital-glitch",    label: "Digital Glitch",     category: "glitch", description: "RGB-split + scanline + datamosh glitch",
    promptHint: "a brief digital glitch corruption — RGB-split, scanline tearing, pixel-block displacement — overtakes the frame for a fraction of a second, and resolves into the new scene" },
  { id: "vhs-rewind",        label: "VHS Rewind",         category: "glitch", description: "VHS tracking distortion",
    promptHint: "VHS-style tracking distortion and tape-rewind artifacts sweep the frame with horizontal scanline noise, then resolve into the new scene as if rewinding to a different recording" },
  { id: "datamosh",          label: "Datamosh",           category: "glitch", description: "Motion-vector smear bleeds scenes",
    promptHint: "datamosh transition: the motion vectors of the first scene continue smearing into the pixels of the second scene, creating a fluid pixel-bleed handoff" },
  { id: "channel-flip",      label: "Channel Flip",       category: "glitch", description: "TV channel flip with static",
    promptHint: "a brief burst of TV static and channel-flip artifacts sweeps the frame, and the new scene resolves as if changing channels on an old television" },
  { id: "hologram-flicker",  label: "Hologram Flicker",   category: "glitch", description: "Hologram-style flicker materialises new scene",
    promptHint: "a hologram-style flicker with horizontal interference bands and chromatic aberration overtakes the frame for a beat, and resolves into the new scene as if it materialised from a projection" },
  { id: "display-wipe",      label: "Display Wipe",       category: "glitch", description: "Scene compresses into display, expands to new scene",
    promptHint: "the first scene compresses into a small floating display screen at the center of the frame with a CRT power-on/off animation and scanline flicker, the display then expands outward and unfolds into the new scene full-frame" },
  { id: "double-exposure",   label: "Double Exposure",    category: "glitch", description: "Two scenes overlay translucent, first fades to second",
    promptHint: "the first and second scenes blend as a translucent double exposure where both images coexist semi-transparently on the frame, the first image then gradually fades out leaving the second image fully resolved" },
]

export const TRANSITION_CATEGORY_ORDER: ReadonlyArray<TransitionCategory> = [
  "standard", "time", "element", "morph", "portal", "physics", "light", "glitch",
]

export const TRANSITION_CATEGORY_LABELS: Readonly<Record<TransitionCategory, string>> = {
  standard: "Standard",
  time:     "Time & Temporal",
  element:  "Element & Teleport",
  morph:    "Morph & Shape-shift",
  portal:   "Portal & Inside",
  physics:  "Physics & Force",
  light:    "Light & Flash",
  glitch:   "Glitch & Digital",
}

const transitionById = new Map<string, Transition>(
  TRANSITIONS.map((t) => [t.id, t]),
)

export function getTransition(id: string | undefined | null): Transition | undefined {
  if (!id) return undefined
  return transitionById.get(id)
}

export function getTransitionLabel(id: string | undefined | null, fallback?: string): string {
  const t = getTransition(id)
  if (t) return t.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getTransitionPromptHint(id: string | undefined | null): string {
  return getTransition(id)?.promptHint ?? ""
}

export const TRANSITION_IDS: ReadonlyArray<string> = TRANSITIONS.map((t) => t.id)

// ---------------------------------------------------------------------------
// Graph-aware composer — start/end input handles + timing fields + multi-pick
// ---------------------------------------------------------------------------

const POSITION_CLAUSES: Record<Exclude<TransitionPosition, "auto">, string> = {
  start:  "the transition occurs at the opening of the clip",
  middle: "the transition occurs in the middle of the clip",
  end:    "the transition occurs at the end of the clip",
  full:   "the transition spans the entire clip",
}

const DURATION_CLAUSES: Record<Exclude<TransitionDuration, "auto">, string> = {
  instant: "occurring instantaneously",
  short:   "lasting approximately 1 second",
  medium:  "lasting approximately 2 seconds",
  long:    "lasting approximately 3 seconds",
}

const INTENSITY_CLAUSES: Record<Exclude<TransitionIntensity, "auto">, string> = {
  subtle:  "with subtle restrained energy and minimal flourish",
  natural: "with natural unhurried timing",
  dynamic: "with dynamic energy and assertive flourish",
  crazy:   "with extreme exaggerated energy, wild flourishes, and dramatic distortion",
}

/**
 * Compose a structural prompt-hint sentence from a transition id (or array
 * of 1-2 ids for multi-pick) plus optional start-state/end-state hints
 * (collected by walking the source node's startState / endState input
 * handle edges upstream) and optional timing fields.
 *
 * Behavior:
 * - 0 hints (no transition, empty array, or all-empty hints) → ""
 * - n base hints joined with ", and "
 * - Timing/start/end clauses apply ONCE at the outer layer, not per-id
 * - null input is treated like undefined (falsy short-circuit → returns "")
 */
export function composeTransitionHintFromConnections(
  transitionId: string | ReadonlyArray<string> | undefined,
  startHints: ReadonlyArray<string>,
  endHints: ReadonlyArray<string>,
  timing?: TransitionTiming,
): string {
  const ids = Array.isArray(transitionId)
    ? Array.from(new Set(transitionId)).slice(0, 2)
    : transitionId ? [transitionId] : []
  const baseHints = ids.map(getTransitionPromptHint).filter((h) => h.length > 0)
  if (baseHints.length === 0) return ""

  const combinedBase = baseHints.join(", and ")
  const parts: string[] = [combinedBase]

  if (timing?.position && timing.position !== "auto") {
    parts.push(POSITION_CLAUSES[timing.position])
  }
  if (timing?.duration && timing.duration !== "auto") {
    parts.push(DURATION_CLAUSES[timing.duration])
  }
  if (timing?.intensity && timing.intensity !== "auto") {
    parts.push(INTENSITY_CLAUSES[timing.intensity])
  }

  const startClause = startHints.filter((h) => h && h.length > 0).join(" and ")
  const endClause = endHints.filter((h) => h && h.length > 0).join(" and ")
  if (startClause) parts.push(`starting from ${startClause}`)
  if (endClause) parts.push(`ending at ${endClause}`)

  return parts.join(", ")
}
