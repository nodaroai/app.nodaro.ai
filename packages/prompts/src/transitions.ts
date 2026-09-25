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

import { resolveTerm, type PickerHintMode } from "./term.js"
import { overlayEntry } from "./catalog-overlay.js"

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
  /**
   * Optional authored compact term (see `term.ts`). Authored where the
   * lowercased label is not what an editor would write in a prompt — a UI
   * compound ("None / Hard Cut" → "hard cut"), an annotation the derivation
   * drops ("Fast-Forward (Day → Night)" → "day-to-night time-lapse"), a bare
   * word that collides with another meaning ("Melt Down", "Channel Flip",
   * "Roll"), or a coinage that is not the trade term ("Seamless Match" →
   * "invisible cut"). Everywhere else the label IS the term.
   */
  readonly term?: string
  /**
   * `true` on rows whose mechanism IS A CUT — the change happens between two
   * frames, so it has no duration to time. A duration clause ("lasting
   * approximately 1 second") on such a row tells the video model to spend a
   * second on the change, and it obliges with a dissolve: a match cut rendered
   * as a 1.75 s cross-dissolve in QA. The composer therefore skips the duration
   * lever when every picked transition is instant, and consumers (the picker
   * UI, Studio) read `isInstantTransition` to hide that lever.
   *
   * The same holds for INTENSITY: every intensity clause describes how the
   * change PERFORMS over time ("natural unhurried timing", "wild flourishes and
   * dramatic distortion"), and a cut has no performance to shape — "unhurried"
   * on a match cut is another invitation to blend. So the composer drops the
   * intensity clause too when every pick is instant. Position still applies —
   * WHERE the cut lands is a real choice — except `full`: a single-frame cut
   * cannot "span the entire clip", so that clause is dropped on an all-instant
   * pick (start / middle / end still place the cut).
   *
   * The bare term is not enough on its own either: "match cut" still came back
   * as a ~1 s superimposition in prod QA (seedance-2-5). The composer therefore
   * puts `INSTANT_CUT_CLAUSE` inside an all-instant pick's parentheses, once — the explicit
   * anti-blend instruction that made the model render a true single-frame cut.
   */
  readonly instant?: boolean
}

/**
 * The three timing scales, each derived from the catalog that defines it (see
 * `TRANSITION_POSITIONS` and friends below).
 *
 * The direction matters. These used to be hand-written unions with the clause
 * tables written out separately beside them, so the two could disagree: add a
 * step to the union, forget the clause, and the composer indexed a missing key
 * — pushing `undefined` into the parts list, which `join(", ")` renders as a
 * dangling separator on a prompt that then ships to a provider with the user's
 * chosen parameter silently dropped. Deriving the union FROM the catalog makes
 * that unrepresentable: one array is the source of the type, the option list
 * the API serves, and the clause table, so a new step reaches all three or
 * none. The exact id sets are pinned by `transition-timing-catalogs.test.ts`.
 */
export type TransitionPosition = (typeof TRANSITION_POSITIONS)[number]["id"]
export type TransitionDuration = (typeof TRANSITION_DURATIONS)[number]["id"]
export type TransitionIntensity = (typeof TRANSITION_INTENSITIES)[number]["id"]

export interface TransitionTiming {
  position?: TransitionPosition
  duration?: TransitionDuration
  intensity?: TransitionIntensity
}

export const TRANSITIONS: ReadonlyArray<Transition> = [
  // ============================================================================
  // STANDARD — 14 entries — classical editing transitions
  // ============================================================================
  { id: "auto",              label: "Auto",              category: "standard", description: "Let the model choose", promptHint: "" },
  { id: "none",              label: "None / Hard Cut",   category: "standard", description: "Instantaneous switch, no transition",
    promptHint: "no transition, hard cut, instantaneous switch from first shot to second shot", term: "hard cut" , instant: true },
  { id: "cross-dissolve",    label: "Cross-Dissolve",    category: "standard", description: "Gradual blend between shots",
    promptHint: "smooth cross-dissolve transition where the first shot gradually fades out as the second shot fades in" },
  { id: "fade-to-black",     label: "Fade to Black",     category: "standard", description: "Darkens to black, second emerges",
    promptHint: "fade to black: the first shot gradually darkens to full black, holds briefly, then the second shot fades up from black" },
  { id: "fade-to-white",     label: "Fade to White",     category: "standard", description: "Blooms to white, second emerges",
    promptHint: "fade to white: the first shot brightens until the frame is pure white, then the second shot resolves out of the white" },
  { id: "snap-to-black",     label: "Snap to Black",     category: "standard", description: "Instant cut to full black for a beat, then the next shot",
    promptHint: "snap to black: the first shot cuts instantly to full black with no fade, the frame holds pure black for a single beat, then the second shot cuts in at full brightness", term: "snap to black" , instant: true },
  { id: "match-cut",         label: "Match Cut",         category: "standard", description: "Shape or motion match across shots",
    promptHint: "match cut: the final composition of the first shot matches the opening composition of the second shot in shape, color, and motion, so the cut feels like a visual rhyme" , instant: true },
  { id: "smash-cut",         label: "Smash Cut",         category: "standard", description: "Jarring abrupt cut between contrasting shots",
    promptHint: "smash cut: an abrupt jarring transition between two visually or tonally contrasting shots with no fade, on a beat" , instant: true },
  { id: "iris",              label: "Iris",              category: "standard", description: "Circular iris closes, then opens on second",
    promptHint: "iris transition: a circular vignette closes inward over the first shot until the frame is black, then opens outward to reveal the second shot", term: "iris wipe" },
  { id: "wipe",              label: "Wipe",              category: "standard", description: "Linear wipe replaces first shot",
    promptHint: "linear wipe transition: a clean diagonal line sweeps across the frame, revealing the second shot behind it", term: "linear wipe" },
  { id: "roll-transition",   label: "Roll",              category: "standard", description: "Frame rolls 90-180°, second shot upright on landing",
    promptHint: "the frame rolls along the camera axis with a smooth 90 to 180 degree rotation, motion-blurred during the roll, and as the rotation completes the new shot is upright and stable in frame", term: "camera roll transition" },
  { id: "seamless-match",    label: "Seamless Match",    category: "standard", description: "Hidden cut disguised by matched motion and color",
    promptHint: "hidden seamless transition: the camera motion, color palette, and on-screen motion at the end of the first shot continue exactly across the cut into the second shot, so the boundary is invisible and the two shots feel like one unbroken take", term: "invisible cut" , instant: true },
  { id: "whip-pan",          label: "Whip Pan",          category: "standard", description: "Camera whips sideways into blur, next shot rides the same direction",
    promptHint: "whip pan transition: the camera whips sideways at high speed, smearing the frame into heavy horizontal motion blur, and the second shot enters already travelling in the same direction before it settles into its framing", term: "whip pan" },
  { id: "jump-cut",          label: "Jump Cut",          category: "standard", description: "Same framing, time skips forward",
    promptHint: "jump cut: the framing, lens, and camera position stay identical across the cut while time skips abruptly forward, so the subject snaps to a new position inside what still reads as one continuous shot", term: "jump cut" , instant: true },

  // ============================================================================
  // TIME — 8 entries — temporal shifts (same or related scene, different time, or memory)
  // ============================================================================
  { id: "fast-forward-day-night",  label: "Fast-Forward (Day → Night)", category: "time", description: "Time-lapse day to night same scene",
    promptHint: "fast-forward time-lapse transition: the sun visibly arcs across the sky, shadows sweep, clouds streak, sky shifts from daylight blue through golden hour to deep night, stars emerge, all while framing and camera position remain locked on the same scene", term: "day-to-night time-lapse" },
  { id: "fast-forward-night-day",  label: "Fast-Forward (Night → Day)", category: "time", description: "Time-lapse night to dawn same scene",
    promptHint: "fast-forward time-lapse transition: stars fade, the sky shifts from deep night through pre-dawn blue to golden sunrise, shadows sweep in reverse, all while framing and camera position remain locked on the same scene", term: "night-to-day time-lapse" },
  { id: "seasonal-shift",          label: "Seasonal Shift",             category: "time", description: "Same scene through changing seasons",
    promptHint: "accelerated seasonal time-lapse: foliage transitions from spring green to summer lushness to autumn red-gold to winter bare, leaves fall and regrow, snow accumulates and melts, all within the same locked framing", term: "seasonal time-lapse" },
  { id: "aging",                   label: "Aging",                      category: "time", description: "Subject visibly ages forward in time",
    promptHint: "accelerated aging transition: the subject visibly ages forward - fine lines deepen into wrinkles, hair greys to silver, posture settles - while the framing stays unchanged", term: "accelerated aging" },
  { id: "rewind",                  label: "Rewind",                     category: "time", description: "Time reverses, motion plays backward",
    promptHint: "rewind transition: reverse motion: the actions just seen are undone exactly as they happened, in reverse order and at the same pace, the subject retracing each step to where it began, ending on the end frame", term: "reverse-motion rewind" },
  { id: "freeze-frame-jump",       label: "Freeze-Frame Jump",          category: "time", description: "Action freezes, jumps forward in time",
    promptHint: "freeze-frame transition: all motion stops mid-action and the picture holds still for a beat; only then does it jump to the same view hours or days later, everything in new positions, and motion resumes", term: "freeze-frame time jump" },
  { id: "weather-shift",           label: "Weather Shift",              category: "time", description: "Same scene through changing weather",
    promptHint: "accelerated weather transition: same scene, framing locked — clear sky darkens to storm clouds, rain begins and intensifies then clears, sun returns through breaking clouds", term: "weather time-lapse" },
  { id: "flashback",               label: "Flashback",                  category: "time", description: "Memory-flashback into a past moment of the subject",
    promptHint: "brief flashback transition: the frame washes with a soft warm or desaturated tint, faint ripple distortion crosses the image as the present scene fades, and a remembered earlier moment resolves into focus on the same subject" },

  // ============================================================================
  // ELEMENT — 14 entries — teleport via natural element
  // ============================================================================
  { id: "dissolve-to-mist",  label: "Dissolve to Mist",   category: "element", description: "Subject turns to mist, drifts, reforms",
    promptHint: "the first subject loses its solid form and turns into a soft cloud of fine mist, starting at its edges and working inward. The camera stays where it is and the framing does not change. The mist drifts through the frame and thins until the first shot is gone, then gathers again at the same place in the frame and condenses into the second subject as the second shot appears behind it. The shot ends on the second subject, solid and fully resolved, with no mist left. The second subject forms only out of the gathered mist" },
  { id: "water-splash",      label: "Water Splash",       category: "element", description: "Subject becomes water, splashes, reforms",
    promptHint: "the first subject turns to water and collapses into a splashing cascade that spreads across the lower part of the frame. The camera stays where it is and the framing does not change. The water surges upward at the same place in the frame and takes the shape of the second subject, while the second shot appears behind it as the spray falls away. The shot ends on the second subject, solid and fully resolved, with no water left on it. The second subject forms only out of the rising water" },
  { id: "sand-scatter",      label: "Sand Scatter",       category: "element", description: "Subject becomes sand, blown away, reforms",
    promptHint: "the subject crumbles into fine sand that is swept away by a gust of wind in a swirling vortex, then the sand particles converge and re-form into the new subject" },
  { id: "fire-burnup",       label: "Burn-Up",            category: "element", description: "Subject burns to embers, embers reform",
    promptHint: "the subject ignites and burns from edges inward into glowing embers and ash, the embers swirl through the frame and re-ignite into the new subject", term: "burn to embers and reform" },
  { id: "smoke-puff",        label: "Smoke Puff",         category: "element", description: "Subject vanishes in smoke, reappears",
    promptHint: "the subject vanishes in a soft puff of smoke that billows outward and fills the frame, the smoke then clears to reveal the new subject in the new scene" },
  { id: "magic-sparkles",    label: "Magic Sparkles",     category: "element", description: "Particle dissolve à la Avengers / apparition",
    promptHint: "the subject disintegrates into a cloud of glowing golden sparkles that scatter outward, then the sparkles converge from across the frame and re-coalesce into the new subject" },
  { id: "lightning-flash",   label: "Lightning Strike",   category: "element", description: "Lightning strikes, scene changes in flash",
    promptHint: "a brilliant jagged bolt of lightning cracks across the frame and its flash turns the whole picture white. The camera stays where it is and the framing does not change. As the flash dies away, the second shot is revealed in its place. The shot ends on the second shot, fully resolved, with no bolt or flash left. The change happens inside the flash, and the second shot appears only as the white fades" },
  { id: "ink-splash",        label: "Ink Splash",         category: "element", description: "Ink splashes across, scene changes",
    promptHint: "black ink splashes across the frame in expanding tendrils that fully cover the image, then the ink retracts inward and pulls back to reveal the new scene" },
  { id: "sand-storm",        label: "Sand Storm",         category: "element", description: "Sand storm engulfs the frame, scene changes inside",
    promptHint: "a wall of opaque, swirling ochre sand sweeps in from one side of the frame and surges across it until the whole picture is hidden in dust. The camera stays where it is and the framing does not change. The dust then thins and sinks away toward the lower edge of the frame, revealing the second shot behind it. The shot ends on the second shot, clear and fully resolved, with no dust left. The first shot stays as it is until the sand covers it completely, and the second shot appears only as the dust clears" },
  { id: "paint-splash",      label: "Paint Splash",       category: "element", description: "Vivid paint splash covers, retracts into new scene",
    promptHint: "vivid splashes of coloured paint fly across the frame in arcing streaks and pile over one another until the whole picture is covered in wet paint. The camera stays where it is and the framing does not change. The paint then gathers toward the centre of the frame and shrinks to nothing, uncovering the second shot from the edges inward. The shot ends on the second shot, clean and fully resolved, with no paint left. The paint lies on the surface of the picture itself, and the second shot appears only where the paint has gone" },
  { id: "aurora-sweep",      label: "Aurora Sweep",       category: "element", description: "Aurora curtain sweeps across, scene changes behind",
    promptHint: "a luminous curtain of green and violet aurora light ripples across the whole frame, and its bright bands veil the first shot. The camera stays where it is and the framing does not change. As the bands fade, the second shot is revealed behind them. The shot ends on the second shot, clear and fully resolved, with no aurora light left. The aurora glows over the front of the picture, and the second shot appears only as it fades" },
  { id: "sakura-petals",     label: "Sakura Storm",       category: "element", description: "Cherry blossom petals storm across the frame",
    promptHint: "a dense storm of cherry blossom petals swirls in from one side and fills the frame in soft pink motion, the petals cluster to fully veil the image, then drift past to reveal the new scene", term: "cherry blossom petal storm" },
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
    promptHint: "the first subject breaks into large square mosaic blocks, and the blocks scatter outward across the frame. The camera stays where it is and the framing does not change. The blocks fly back, lock together at the same place in the frame and sharpen into the second subject, while the second shot appears behind them. The shot ends on the second subject, fully sharp, with no blocks left. Only the subject turns into blocks; the surroundings change as the blocks clear", term: "pixelate and reform" },
  { id: "shatter-glass",     label: "Shatter & Reform",   category: "morph", description: "Subject shatters like glass, reforms",
    promptHint: "the first subject shatters like glass into hundreds of shards that fly outward, then the shards reverse direction in reverse time and reassemble into the new subject", term: "shatter like glass and reform" },
  { id: "origami-fold",      label: "Origami Fold",       category: "morph", description: "Subject folds like paper into new subject",
    promptHint: "the first subject creases and folds like sheets of origami paper, the folds rotate and re-arrange in elegant geometric steps, and the final fold reveals the new subject" },
  { id: "vortex-swirl",      label: "Vortex Swirl",       category: "morph", description: "Subject swirls into vortex, unwinds as new",
    promptHint: "only the first subject twists, winding around its own centre like wrung cloth into a tight narrow column at the same place in the frame, turning faster as it narrows, while the surroundings stay upright and still. the camera is locked on a tripod head planted in one spot, holding the frame level from start to finish. the column then unwinds in the same direction and opens into the shape of the second subject, while the second shot appears around it. the shot ends on the second subject, solid and fully resolved, with nothing left turning. the twist stays inside the outline of the subject, and the edges of the frame stay square and still" },
  { id: "dream-ripple",      label: "Dream Ripple",       category: "morph", description: "Surface ripple wave reveals new scene",
    promptHint: "a circular ripple radiates outward across the frame as if the image were the surface of water, and where the ripple passes the first scene is replaced by the second scene" },
  { id: "wireframe-morph",   label: "Wireframe Morph",    category: "morph", description: "Subject reduces to wireframe, reforms as new subject",
    promptHint: "the first subject's surface peels away to reveal a glowing geometric wireframe of polygons and edges, the wireframe flexes and re-tessellates into the topology of the new subject, then the new surface skins over the wireframe" },
  { id: "polygon-shatter",   label: "Polygon Shatter",    category: "morph", description: "Subject fragments into low-poly chunks, reassembles",
    promptHint: "the first subject fractures into large opaque flat-shaded chunks, like the facets of a low-polygon model, and the chunks burst outward in slow motion. The camera stays where it is and the framing does not change. The chunks turn around mid-flight and fly back along clean straight paths, locking together at the same place in the frame into the shape of the second subject, while the second shot appears behind them. The shot ends on the second subject, solid and fully resolved, with no loose chunks left. The chunks stay opaque and matte throughout, like painted blocks" },
  { id: "melt-down",         label: "Melt Down",          category: "morph", description: "Subject melts into puddle, reforms as new",
    promptHint: "the first subject's form softens and melts downward like wax, collapsing into a glossy puddle on the ground, the puddle then surges upward and re-solidifies into the new subject standing in the new scene", term: "melt into a puddle and reform" },

  // ============================================================================
  // PORTAL — 12 entries — zoom-into-object world-jumps
  // ============================================================================
  { id: "zoom-into-eye",     label: "Zoom Into Eye",        category: "portal", description: "Push into pupil, new world inside",
    promptHint: "the camera pushes into a tight macro of the subject's eye, the pupil dilates and fills the frame, and the new scene materialises from within the pupil as if the pupil itself were a portal" },
  { id: "zoom-into-mirror",  label: "Zoom Into Mirror",     category: "portal", description: "Push into mirror, scene inside reflection",
    promptHint: "the camera pushes toward a mirror in the scene, the mirror's reflection fills the frame, and the camera passes through the mirror surface into the reflected world which becomes the new scene" },
  { id: "zoom-into-screen",  label: "Zoom Into Screen",     category: "portal", description: "Push into TV/phone screen",
    promptHint: "the camera pushes toward a screen visible in the scene, such as a TV, phone or monitor, the screen's image fills the frame, and the camera passes through into that image which becomes the new scene" },
  { id: "zoom-into-book",    label: "Zoom Into Book",       category: "portal", description: "Push into book page illustration",
    promptHint: "the camera pushes down toward the illustrated page of an open book in the frame until the illustration fills the whole picture. The camera travels in one smooth line, without turning or rolling. The drawn picture comes alive, gaining depth, light and movement, and becomes the second shot. The shot ends inside the second shot, real and fully resolved, with no paper, ink lines or page edges left. The camera heads for the page from the start and goes into its illustration" },
  { id: "walk-through-door", label: "Walk Through Doorway", category: "portal", description: "Through doorway into new scene",
    promptHint: "the camera follows the first subject through a doorway in the frame, moving forward at the subject's pace. The camera travels straight forward, without turning, tilting or rolling. On the far side of the doorway the space is the second shot, a different place in different light. The shot ends in the second shot, fully resolved, with the doorway behind the camera. The change of place happens at the doorway itself, the moment the camera passes through it" },
  { id: "fall-into-hole",    label: "Fall Into Hole",       category: "portal", description: "Camera falls through opening",
    promptHint: "the floor or ground opens beneath the camera and the camera falls downward through the opening, tumbling, and emerges into the new scene below" },
  { id: "pull-out-reveal",   label: "Pull-Out Reveal",      category: "portal", description: "Reveals scene was a picture in larger context",
    promptHint: "the camera pulls straight back fast, and the whole first shot shrinks until its edges show as the border of a framed picture inside a larger space. The camera travels back in one smooth line, without turning, tilting or rolling. The larger space around the picture is the second shot, and the first shot stays inside the picture. The shot ends on the second shot, with the first shot visible as a picture within it. The first shot's image stays exactly the same as it shrinks, so it reads as the same picture all along", term: "pull-back reveal" },
  { id: "zoom-into-mouth",   label: "Zoom Into Mouth",      category: "portal", description: "Push into open mouth, emerges in new world inside",
    promptHint: "the camera pushes straight into the first subject's open mouth until the dark interior fills the whole picture. The camera travels forward in one smooth line, without turning, tilting or rolling. It passes through the darkness, and the second shot emerges out of it. The shot ends inside the second shot, still and fully resolved, with no mouth left in view. The dark interior stays a plain darkness the camera passes through" },
  { id: "push-through-glass", label: "Push Through Glass",   category: "portal", description: "Camera pushes through pane of glass into new world",
    promptHint: "the camera pushes toward a pane of glass in the scene, the surface ripples like liquid as the camera passes through with a faint refraction, and the space on the other side resolves as the new scene" },
  { id: "soul-jump",         label: "Soul Jump",            category: "portal", description: "Translucent soul leaves body, enters new body",
    promptHint: "a translucent luminous form rises out of the first subject's body and shoots forward through the frame as a ghost-like soul, then dives into a new body in the new scene where the second subject animates to life", term: "soul leaves body and enters another" },
  { id: "mask-transition",   label: "Mask Transition",   category: "portal", description: "Foreground object blacks out the frame, camera pulls through",
    promptHint: "a dark foreground shape sweeps across the lens and fills the frame with black. The camera keeps travelling forward through the black in one smooth line. It emerges from the darkness into the second shot. The shot ends in the second shot, fully resolved, with no dark shape left. The dark shape passes close to the lens and is gone once the second shot appears", term: "mask transition" },
  { id: "zoom-through",      label: "Zoom Through",      category: "portal", description: "Camera magnifies one detail until the new scene unfolds inside it",
    promptHint: "zoom-through transition: the camera magnifies one small detail of the frame further and further until the detail loses its texture and fills the image entirely, and the new scene unfolds from within it", term: "zoom-through transition" },

  // ============================================================================
  // PHYSICS — 10 entries — force-driven transitions
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
    promptHint: "the largest structure in the frame detonates in a massive fireball, and debris and dust plume outward until they fill the whole picture. The camera stays where it is and the framing does not change. As the dust cloud clears, the second shot is revealed in its place. The shot ends on the second shot, clear and fully resolved, with no dust or debris left. The blast comes from that structure itself, and the second shot appears only as the dust clears" },
  { id: "vehicle-explosion", label: "Vehicle Explosion",  category: "physics", description: "Vehicle detonates in foreground, scene changes behind",
    promptHint: "a vehicle in the frame bursts into a violent explosion of fire and twisted metal, and the fireball billows toward the lens until orange flame fills the whole picture. The camera stays where it is and the framing does not change. The flame gives way to thick smoke, and as the smoke parts the second shot is revealed. The shot ends on the second shot, clear and fully resolved, with no fire or smoke left. The explosion comes from that vehicle itself, and the second shot appears only as the smoke parts" },
  { id: "jump-match",        label: "Jump Match",         category: "physics", description: "Subject jumps, landing matches into new scene",
    promptHint: "the subject jumps upward and out of frame at the end of the first shot, with matched velocity the camera follows the arc, and on landing the subject is in a new location seamlessly continuing the same jump", term: "match cut on a jump" , instant: true },
  { id: "hand-swipe",        label: "Hand Swipe",         category: "physics", description: "Hand swipes across lens, scene changes during occlusion",
    promptHint: "a hand sweeps across the camera lens at close range, fully occluding the frame in motion blur for a single beat, and as the hand exits the opposite side the scene has changed to the new setting" },
  { id: "action-relay",      label: "Action Match",      category: "physics", description: "Subject exits on an action and lands in the new scene mid-move",
    promptHint: "match cut on action: the subject exits the frame on a committed action — a stride, a throw, a turn — and enters the new scene on the same beat continuing that movement at matched speed and direction, so the action carries unbroken across the cut", term: "match cut on action" , instant: true },

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
    promptHint: "intense warm glare floods the lens from one corner of the frame, blooming and scattering flares until the whole picture is washed out to a bright haze. The camera stays where it is and the framing does not change. As the glare fades, the second shot emerges through the haze. The shot ends on the second shot, clear and fully resolved, with no glare left. The glare comes from the lens itself, and the second shot appears only as the haze clears" },
  { id: "lens-crack",        label: "Lens Crack",         category: "light", description: "Lens cracks, scene through fractured glass",
    promptHint: "a hairline crack snaps diagonally across the lens and branches into a web of fracture lines that spreads over the whole picture. The camera stays where it is and the framing does not change. Seen through the cracks, the first shot gives way to the second shot, and then the fracture lines fade away. The shot ends on the second shot, clear and fully resolved, with no cracks left. The cracks form on the lens itself, while everything behind them stays whole" },
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
    promptHint: "a brief burst of TV static and channel-flip artifacts sweeps the frame, and the new scene resolves as if changing channels on an old television", term: "tv channel flip with static" },
  { id: "hologram-flicker",  label: "Hologram Flicker",   category: "glitch", description: "Hologram-style flicker materialises new scene",
    promptHint: "a hologram-style flicker with horizontal interference bands and chromatic aberration overtakes the frame for a beat, and resolves into the new scene as if it materialised from a projection" },
  { id: "display-wipe",      label: "Display Wipe",       category: "glitch", description: "Scene compresses into display, expands to new scene",
    promptHint: "the first scene compresses into a small floating display screen at the center of the frame with a CRT power-on/off animation and scanline flicker, the display then expands outward and unfolds into the new scene full-frame", term: "compress into a screen and expand out" },
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
  return overlayEntry("transitions", id, transitionById.get(id))
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

/**
 * Compact professional TERM for an id — the short phrase an editor would write
 * in a prompt ("hard cut", "invisible cut", "day-to-night time-lapse"), as
 * opposed to the paragraph-length `promptHint`.
 *
 * Same lookup and same empty-string-on-miss behavior as
 * `getTransitionPromptHint`, so the two can never disagree about which entry
 * they describe. The no-op "Auto" entry resolves to `""` in both.
 */
export function getTransitionTerm(id: string | undefined | null): string {
  return resolveTerm(getTransition(id))
}

export const TRANSITION_IDS: ReadonlyArray<string> = TRANSITIONS.map((t) => t.id)

/**
 * Whether a transition is a CUT — instantaneous by nature, so it takes no
 * duration (see `Transition.instant`). Reads through `getTransition`, so it
 * answers for the same entry every other getter describes; an unknown id, the
 * no-op "auto" and an empty value are all `false`.
 *
 * A multi-pick (`string[]`) is instant only when EVERY picked id is: a cut
 * paired with a dissolve still has a dissolve to time.
 */
export function isInstantTransition(
  id: string | ReadonlyArray<string> | undefined | null,
): boolean {
  const ids = typeof id === "string" ? [id] : id ? [...id] : []
  if (ids.length === 0) return false
  return ids.every((one) => getTransition(one)?.instant === true)
}

/**
 * The anti-blend instruction an all-instant transition pick carries — the ONE
 * place this sentence lives (see `Transition.instant`). Each row keeps its own
 * meaning in its own hint (a match cut still matches shapes, snap to black
 * still holds black for a beat); this clause only forbids the blend a video
 * model otherwise puts between the two images. Measured on prod with
 * seedance-2-5: with it, a match cut renders as a true single-frame hard cut,
 * with and without an end frame; without it, as a ~1 s dissolve.
 */
export const INSTANT_CUT_CLAUSE =
  "an abrupt single-frame hard cut, no dissolve, crossfade or superimposition; the two images never blend"

/**
 * A short "<label>: " heading at the head of a hint ("match cut: …", "whip pan
 * transition: …", "fast-forward time-lapse transition: …"). At most five words
 * with no clause punctuation, so a colon deep inside a sentence never matches.
 * ANY such heading is stripped — including one on a catalog-pack row — because
 * the term already names the move (documented in
 * `docs/design/catalog-pack-seam.md` and `docs/nodes/parameters/transition.md`).
 */
const LEADING_LABEL = /^\s*((?:[^\s:,;.()]+\s+){0,4}[^\s:,;.()]+)\s*:\s+/

const normalizePhrase = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ")

/**
 * The hint BODY that goes inside a transition's parentheses: the promptHint
 * with its leading "<label>:" heading removed (the term already names it) and
 * any comma-separated item that merely restates the term dropped (`none`'s
 * "no transition, hard cut, instantaneous switch …" loses its "hard cut").
 */
function transitionHintBody(id: string, term: string): string {
  const hint = getTransitionPromptHint(id).replace(LEADING_LABEL, "").trim()
  const t = normalizePhrase(term)
  return hint
    .split(/,\s*/)
    .filter((item) => normalizePhrase(item) !== t)
    .join(", ")
    .trim()
}

/**
 * One picked transition as a VIDEO prompt reads it: `<term> (<hint body>)`.
 * The term names the move in the editor's own words; the parentheses carry the
 * model-facing mechanism, which the term alone does not convey (a bare "match
 * cut" rendered as a dissolve on prod). `withCutClause` appends
 * `; INSTANT_CUT_CLAUSE` inside the parentheses. A row whose hint is just its
 * term (or empty) renders as the term alone; an unknown id or "auto" as "".
 */
function transitionFragment(id: string, withCutClause: boolean): string {
  const term = getTransitionTerm(id)
  if (!term) return ""
  const inner = [transitionHintBody(id, term), withCutClause ? INSTANT_CUT_CLAUSE : ""]
    .filter((part) => part.length > 0)
    .join("; ")
  return inner.length > 0 && normalizePhrase(inner) !== normalizePhrase(term)
    ? `${term} (${inner})`
    : term
}

/**
 * The transition BASE fragments for a pick — one `<term> (<hint body>)` per id
 * that resolves to a term, in pick order. When EVERY contributing id is
 * instant, the FIRST fragment's parentheses also carry `; INSTANT_CUT_CLAUSE`
 * (once per pick — two cuts picked together are still one cut). FIRST, not
 * last: the direction fold sheds fragments from the TAIL under a provider cap,
 * so the clause rides the fragment that survives longest. A mixed pick carries
 * no clause: its non-cut is meant to blend.
 *
 * The same text in both hint modes. A transition only ever reaches a VIDEO
 * prompt (the registry row is `surface: "video"`; the canvas node is in
 * `VIDEO_ONLY_PARAMETER_NODE_TYPES`), and there the bare compact term was not
 * enough to steer the model, so the mode no longer changes a transition.
 *
 * Each fragment is ONE string, parentheses included: the cap-aware assemblers
 * shed whole fragments from the tail, so a fragment is kept or dropped whole
 * and can never lose its hint or its clause on its own.
 *
 * Shared by `composeTransitionHintFromConnections` (the canvas transition node,
 * Studio's transition clauses) and the direction registry's `transition` row
 * (the server fold of `direction.transition`), so both paths word a transition
 * identically.
 */
export function renderTransitionBases(
  ids: ReadonlyArray<string>,
  _mode: PickerHintMode = "full",
): string[] {
  // Only ids that contribute a fragment count — a no-op "auto" beside a cut
  // must not make the pick look non-instant.
  const picked = ids.filter((id) => getTransitionTerm(id).length > 0)
  const instant = isInstantTransition(picked)
  return picked.map((id, i) => transitionFragment(id, instant && i === 0))
}

// ---------------------------------------------------------------------------
// Graph-aware composer — start/end input handles + timing fields + multi-pick
// ---------------------------------------------------------------------------

/**
 * The transition node's three timing parameters, as catalogs.
 *
 * These are graded scales, not free numbers — the same shape as
 * `exposure-settings`' aperture or `temporal`'s speed — so a consumer that can
 * only send ids (Studio, the SDK, MCP) can offer them without composing prompt
 * text of its own. `auto` is the no-op head of each scale: an empty
 * `promptHint`, so an unset parameter contributes nothing and the model is left
 * to decide, exactly as before these were enumerable.
 *
 * `POSITION_CLAUSES` / `DURATION_CLAUSES` / `INTENSITY_CLAUSES` below are
 * DERIVED from these arrays, so the clause the composer injects and the hint
 * the catalog advertises are the same string by construction and cannot drift.
 */
export interface TransitionTimingOption {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly promptHint: string
  readonly term?: string
}

export const TRANSITION_POSITIONS = [
  { id: "auto",   label: "Auto",   description: "Let the model place it",        promptHint: "", term: "" },
  { id: "start",  label: "Start",  description: "At the opening of the clip",    promptHint: "the transition occurs at the opening of the clip", term: "at the opening of the clip" },
  { id: "middle", label: "Middle", description: "In the middle of the clip",     promptHint: "the transition occurs in the middle of the clip", term: "mid-clip" },
  { id: "end",    label: "End",    description: "At the end of the clip",        promptHint: "the transition occurs at the end of the clip", term: "at the end of the clip" },
  { id: "full",   label: "Full",   description: "Spans the entire clip",         promptHint: "the transition spans the entire clip", term: "across the whole clip" },
] as const satisfies ReadonlyArray<TransitionTimingOption>

export const TRANSITION_DURATIONS = [
  { id: "auto",    label: "Auto",    description: "Let the model time it",       promptHint: "", term: "" },
  { id: "instant", label: "Instant", description: "No perceptible duration",     promptHint: "occurring instantaneously", term: "instantaneous" },
  { id: "short",   label: "Short (~1s)",   description: "Approximately 1 second",  promptHint: "lasting approximately 1 second", term: "about 1 second" },
  { id: "medium",  label: "Medium (~2s)",  description: "Approximately 2 seconds", promptHint: "lasting approximately 2 seconds", term: "about 2 seconds" },
  { id: "long",    label: "Long (~3s)",    description: "Approximately 3 seconds", promptHint: "lasting approximately 3 seconds", term: "about 3 seconds" },
] as const satisfies ReadonlyArray<TransitionTimingOption>

export const TRANSITION_INTENSITIES = [
  { id: "auto",    label: "Auto",    description: "Let the model judge it",      promptHint: "", term: "" },
  { id: "subtle",  label: "Subtle",  description: "Restrained, minimal flourish", promptHint: "with subtle restrained energy and minimal flourish", term: "subtly" },
  { id: "natural", label: "Natural", description: "Unhurried, unforced timing",  promptHint: "with natural timing", term: "at a natural pace" },
  { id: "dynamic", label: "Dynamic", description: "Assertive, energetic",        promptHint: "with dynamic energy and assertive flourish", term: "energetically" },
  { id: "crazy",   label: "Crazy",   description: "Extreme, wild, distorted",    promptHint: "with extreme exaggerated energy, wild flourishes, and dramatic distortion", term: "wildly exaggerated" },
] as const satisfies ReadonlyArray<TransitionTimingOption>

/**
 * Index a timing catalog into the `Record<value, clause>` the composer reads.
 *
 * The key type is derived from the SAME array, so the record is total over the
 * catalog by construction. That matters: the composer indexes these records
 * without a fallback, and a missing key would push `undefined` into the parts
 * list, which `join(", ")` renders as a dangling separator — a malformed prompt
 * shipped to a provider with the user's chosen parameter silently dropped.
 */
function clausesOf<T extends TransitionTimingOption>(
  options: ReadonlyArray<T>,
): Record<Exclude<T["id"], "auto">, string> {
  return Object.fromEntries(
    options.filter((o) => o.id !== "auto").map((o) => [o.id, o.promptHint]),
  ) as Record<Exclude<T["id"], "auto">, string>
}

const POSITION_CLAUSES = clausesOf(TRANSITION_POSITIONS)

/**
 * Where the composed hint lands. `"clip"` (the default) is a whole video's
 * prompt, so a position is placed within "the clip". `"shot"` is one shot's
 * time window inside a multi-shot prompt (`0-2s — …`, `2-4s — …`): there "the
 * middle of the clip" points the model at the wrong span, so the position
 * clause says "of this shot" instead.
 */
export type TransitionHintScope = "clip" | "shot"

export interface TransitionHintOptions {
  readonly scope?: TransitionHintScope
}

/**
 * The position clauses for a shot window — DERIVED from `POSITION_CLAUSES`, so
 * the catalog stays the one source of the wording: every " of the clip" reads
 * " of this shot", and `full`'s "the entire clip" reads "this entire shot".
 * `transitions-scope.test.ts` pins that every non-auto row changes, so a
 * reword that drops either phrase fails loudly instead of quietly saying
 * "clip" inside a shot window.
 */
const SHOT_POSITION_CLAUSES: typeof POSITION_CLAUSES = Object.fromEntries(
  Object.entries(POSITION_CLAUSES).map(([id, clause]) => [
    id,
    clause.replace(/ of the clip\b/g, " of this shot").replace(/ the entire clip\b/g, " this entire shot"),
  ]),
) as typeof POSITION_CLAUSES

const DURATION_CLAUSES = clausesOf(TRANSITION_DURATIONS)
const INTENSITY_CLAUSES = clausesOf(TRANSITION_INTENSITIES)

/**
 * Compose a structural prompt-hint sentence from a transition id (or array
 * of 1-2 ids for multi-pick) plus optional start-state/end-state hints
 * (collected by walking the source node's startState / endState input
 * handle edges upstream) and optional timing fields.
 *
 * Behavior:
 * - 0 hints (no transition, empty array, or all-empty hints) → ""
 * - each pick rendered `<term> (<hint body>)` (`renderTransitionBases`),
 *   n picks joined with ", and "
 * - Timing/start/end clauses apply ONCE at the outer layer, not per-id
 * - When every picked id is instant (a cut — see `isInstantTransition`) the
 *   first base's parentheses carry `INSTANT_CUT_CLAUSE` once, and the
 *   duration and intensity clauses are dropped; position still applies,
 *   except `full` — a single-frame cut spans nothing, so it adds no clause
 * - null input is treated like undefined (falsy short-circuit → returns "")
 *
 * @param mode Accepted for the picker-hint signature; a transition composes
 *   the same text in both modes — each pick as `<term> (<hint body>)`, see
 *   `renderTransitionBases`.
 * @param options `scope: "shot"` when the hint is folded into one shot's time
 *   window of a multi-shot prompt — the position clause then says "of this
 *   shot" instead of "of the clip" (and `full`, on a non-cut, "spans this
 *   entire shot"). Omitted, the wording is the clip's.
 */
export function composeTransitionHintFromConnections(
  transitionId: string | ReadonlyArray<string> | undefined,
  startHints: ReadonlyArray<string>,
  endHints: ReadonlyArray<string>,
  timing?: TransitionTiming,
  mode: PickerHintMode = "full",
  options?: TransitionHintOptions,
): string {
  const ids = Array.isArray(transitionId)
    ? Array.from(new Set(transitionId)).slice(0, 2)
    : transitionId ? [transitionId] : []
  const baseHints = renderTransitionBases(ids, mode)
  if (baseHints.length === 0) return ""
  // Same "contributes a fragment" filter `renderTransitionBases` applies.
  const instant = isInstantTransition(ids.filter((id) => getTransitionTerm(id).length > 0))

  const combinedBase = baseHints.join(", and ")
  const parts: string[] = [combinedBase]

  // "Spans the entire clip" beside a single-frame cut contradicts it, so an
  // all-instant pick drops `full`; start / middle / end still place the cut.
  if (timing?.position && timing.position !== "auto" && !(instant && timing.position === "full")) {
    const clauses = options?.scope === "shot" ? SHOT_POSITION_CLAUSES : POSITION_CLAUSES
    parts.push(clauses[timing.position])
  }
  // A cut has no duration and no performance: "lasting approximately 1
  // second" or "with natural timing" on a match cut makes the model
  // render a dissolve. Skipped only when EVERY picked id is instant — a mixed
  // pick still has a non-cut to time and shape.
  if (timing?.duration && timing.duration !== "auto" && !instant) {
    parts.push(DURATION_CLAUSES[timing.duration])
  }
  if (timing?.intensity && timing.intensity !== "auto" && !instant) {
    parts.push(INTENSITY_CLAUSES[timing.intensity])
  }

  const startClause = startHints.filter((h) => h && h.length > 0).join(" and ")
  const endClause = endHints.filter((h) => h && h.length > 0).join(" and ")
  if (startClause) parts.push(`starting from ${startClause}`)
  if (endClause) parts.push(`ending at ${endClause}`)

  return parts.join(", ")
}
