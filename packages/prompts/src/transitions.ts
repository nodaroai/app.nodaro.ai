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
   * clause when every picked transition is instant (on a BLENDABLE cut, a
   * `blendsCut` step changes the cut itself instead — see `blendable`), and
   * consumers (the canvas panel, Studio) read `isInstantTransition` and
   * `isBlendableTransition` to offer only the levers a cut takes: Position
   * without `full`, no Intensity, and Duration only on a blendable cut, as a
   * Blend lever of "hard cut" plus the `blendsCut` steps.
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
  /**
   * `true` on a CUT that may become a BLENDED CUT: picked with a duration step
   * that `blendsCut` (Short), the pick's anti-blend `INSTANT_CUT_CLAUSE` is
   * REPLACED by `blendedCutClause` — the two shots blend into each other over
   * that step's own `term` — and every other rule of a cut stands (position
   * without `full`, no duration clause, no intensity clause). Any other
   * duration leaves it a hard cut. See `isBlendableTransition`.
   *
   * Set on `seamless-match` and `jump-match` only. In the blended-cut test
   * round (2026-10-04) their blended takes at Short kept what makes each row
   * itself — the invisible cut still hid its join, the jump match still held
   * the subject's place across the leap — and were approved. The blended takes
   * of `match-cut`, `jump-cut` and `action-relay` lost their trait and rated
   * below their hard cut, so those rows stay hard cuts at every duration, as
   * do `none`, `snap-to-black` and `smash-cut`, whose descriptions a blend
   * would contradict ("instantaneous", "on a single frame", "no fade").
   */
  readonly blendable?: boolean
  /**
   * PER-ROW OPTIONS — extra choices that only mean something for THIS
   * transition (a wipe's direction), each written into the row's own hint.
   *
   * Unlike the timing scales (every row has a position), an option is declared
   * by the row that reads it, so it never appears beside a transition it would
   * not change. The row authors `promptTemplate` — its hint with one
   * `{<field>}` token per option — and `promptHint` is DERIVED from it with
   * every option on its `auto` choice (see `withOptionSlots`), so a reader of
   * the plain `promptHint` (the picker catalog, the analyzer, a catalog pack)
   * always sees a finished sentence and never a token.
   *
   * The choice's `phrase` is what fills the token, so the row BODY and the
   * option WORDING are separate: a reworded body keeps its options as long as
   * it keeps the token. `transition-options.test.ts` pins that every template
   * carries exactly one token per option and no other.
   */
  readonly options?: ReadonlyArray<TransitionOption>
  /** The hint with a `{<field>}` token per `options` entry — see `options`. */
  readonly promptTemplate?: string
}

/**
 * One choice of a per-row option. `auto` leads every option and is the choice
 * `promptHint` is written with: picking it (or picking nothing) sends no value.
 */
export interface TransitionOptionChoice {
  readonly id: string
  readonly label: string
  readonly description: string
  /** The words that fill the row template's `{<field>}` token. */
  readonly phrase: string
  /** The compact term for the choice ("left to right"); `""` on `auto`. */
  readonly term: string
}

/** A per-row option (see `Transition.options`). */
export interface TransitionOption {
  /** The node-data field the chosen id is stored under — also the template
   *  token's name (`{wipeDirection}`). Unique within a row; SHARED across rows
   *  only where the rows mean the same kind of setting (`style`, see
   *  `TRANSITION_STYLE_FIELD`) — each row still declares its own choices, and
   *  a value is read only by the row that declares it. */
  readonly field: string
  readonly label: string
  /** `auto` first. */
  readonly choices: ReadonlyArray<TransitionOptionChoice>
}

/**
 * The chosen option ids, keyed by `TransitionOption.field`
 * (`{ wipeDirection: "left-to-right" }`). One flat record for a whole pick: a
 * row reads only the fields it declares, so the other row of a two-pick, or a
 * value left behind by an earlier pick, changes nothing.
 */
export type TransitionOptionValues = Readonly<Record<string, string | undefined>>

/**
 * The wipe's direction. The phrase is the edge AND its travel, so the row's
 * body is free to change around it (`a clean {wipeDirection}, revealing …`).
 * `auto` names no orientation at all — a straight edge — and is what a pick
 * with no direction has always meant.
 */
export const WIPE_DIRECTION: TransitionOption = {
  field: "wipeDirection",
  label: "Direction",
  choices: [
    { id: "auto", label: "Auto", description: "Let the model choose the direction", term: "",
      phrase: "straight edge sweeps across the frame" },
    { id: "left-to-right", label: "Left → Right", description: "A vertical edge travels from the left side to the right", term: "left to right",
      phrase: "vertical edge sweeps across the frame from left to right" },
    { id: "right-to-left", label: "Right → Left", description: "A vertical edge travels from the right side to the left", term: "right to left",
      phrase: "vertical edge sweeps across the frame from right to left" },
    { id: "top-to-bottom", label: "Top → Bottom", description: "A horizontal edge travels down from the top", term: "top to bottom",
      phrase: "horizontal edge sweeps down the frame from top to bottom" },
    { id: "bottom-to-top", label: "Bottom → Top", description: "A horizontal edge travels up from the bottom", term: "bottom to top",
      phrase: "horizontal edge sweeps up the frame from bottom to top" },
    { id: "top-left-to-bottom-right", label: "Top-left → Bottom-right", description: "A diagonal edge travels from the top-left corner to the bottom-right", term: "top-left to bottom-right",
      phrase: "diagonal edge sweeps across the frame from the top-left corner to the bottom-right corner" },
    { id: "top-right-to-bottom-left", label: "Top-right → Bottom-left", description: "A diagonal edge travels from the top-right corner to the bottom-left", term: "top-right to bottom-left",
      phrase: "diagonal edge sweeps across the frame from the top-right corner to the bottom-left corner" },
  ],
}

/**
 * STYLE — a row's alternative LOOKS, each a complete description.
 *
 * A styled row's `promptTemplate` is the single token `{style}`, so choosing a
 * style swaps the row's whole body, not a phrase inside it. The field is SHARED
 * by every styled row (one document key, `style`), but each row declares its
 * own choices, and every choice id but `auto` carries the row's id as a prefix
 * (`debris-shower-light-sweep`), so a stored style can never mean something on
 * another row: re-pointing the pick drops it, and a row reads a foreign id as
 * its default.
 *
 * `auto` is the row's DEFAULT look — labelled with that look's name
 * ("Full cover (default)"), never "Auto", because it is a specific look and not
 * "the model decides". Picking it stores nothing, so a pick with no style (every
 * pick made before styles existed) reads as the default.
 *
 * Every body below is the text a tested A/B take was generated from (tidied:
 * first letter lower-cased, final full stop dropped). `term` is `""` on every
 * choice: the row's own term leads the compact rendering whatever the style.
 */
function rowStyle(
  row: string,
  choices: ReadonlyArray<{ readonly slug?: string; readonly label: string; readonly description: string; readonly phrase: string }>,
): TransitionOption {
  return {
    field: TRANSITION_STYLE_FIELD,
    label: "Style",
    choices: choices.map((c, i) => ({
      id: i === 0 ? "auto" : `${row}-${c.slug}`,
      label: i === 0 ? `${c.label} (default)` : c.label,
      description: c.description,
      phrase: c.phrase,
      term: "",
    })),
  }
}

/** The shared node-data field every styled row stores its look under. */
export const TRANSITION_STYLE_FIELD = "style"

export const DEBRIS_SHOWER_STYLE: TransitionOption = rowStyle("debris-shower", [
  { label: "Full cover", description: "Debris fills the whole screen, then blows past to reveal the next scene",
    phrase: "a dense shower of loose leaves, paper scraps and dust whips across the frame from one side, close to the lens, thick enough to hide the whole picture. The camera stays where it is and the framing does not change. As the last of the debris blows past the far edge, the second shot is revealed behind it. The shot ends on the second shot, clear and fully resolved, with no debris left. The debris passes in front of the picture in one direction, and the second shot appears only once it has passed" },
  { slug: "light-sweep", label: "Light sweep", description: "A quick scatter of debris crosses the screen; the scene has changed behind it",
    phrase: "a shower of debris — leaves, papers, dust — sweeps across the frame in front of the camera, and once the debris clears the scene behind has changed" },
])

export const GARDEN_BLOOM_STYLE: TransitionOption = rowStyle("garden-bloom", [
  { label: "Grow & part", description: "Flowers and vines grow over the picture, then part like curtains on the next scene",
    phrase: "lush flowers and vines rapidly grow and bloom outward from the edges of the frame, the foliage spreads to overtake the entire image, then parts open like curtains to reveal the new scene behind" },
  { slug: "hedge-doors", label: "Hedge doors", description: "Leafy panels close over the picture, then slide apart to the sides",
    phrase: "vines and flowers grow rapidly inward from the edges of the frame, blooming as they spread, until leaves and blossoms cover the whole picture. The camera stays where it is and the framing does not change. The foliage then splits down the middle and draws apart toward the side edges, opening onto the second shot behind it. The shot ends on the second shot, clear and fully resolved, with no leaves or flowers left. The plants grow over the front of the picture, and the first shot stays unchanged until they cover it completely" },
])

export const SMOKE_PUFF_STYLE: TransitionOption = rowStyle("smoke-puff", [
  { label: "Engulf", description: "Smoke billows up around the subject, and the new subject appears inside it",
    phrase: "the subject vanishes in a soft puff of smoke that billows outward and fills the frame, the smoke then clears to reveal the new subject in the new scene" },
  { slug: "full-cover", label: "Full cover", description: "Smoke from the subject fills the whole screen, then clears on the next scene",
    phrase: "the first subject vanishes in a sudden soft puff of smoke that billows outward from where it stood until the smoke fills the frame. The camera stays where it is and the framing does not change. The smoke thins and clears from the centre outward, revealing the second shot with the second subject at the same place in the frame. The shot ends on the second shot, clear and fully resolved, with no smoke left. The smoke comes only from where the first subject was" },
])

export const SAKURA_PETALS_STYLE: TransitionOption = rowStyle("sakura-petals", [
  { label: "Swirling veil", description: "A swirl of pink petals veils the picture, then drifts past",
    phrase: "a dense storm of cherry blossom petals swirls in from one side and fills the frame in soft pink motion, the petals cluster to fully veil the image, then drift past to reveal the new scene" },
  { slug: "side-sweep", label: "Side sweep", description: "Petals sweep across from one side and leave by the other, uncovering the next scene",
    phrase: "a dense storm of pink cherry blossom petals swirls in from one side of the frame, close to the lens, and thickens until the petals veil the whole picture. The camera stays where it is and the framing does not change. The petals keep drifting the same way and thin out, revealing the second shot behind them. The shot ends on the second shot, clear and fully resolved, with no petals left. The petals fly across the front of the picture in one direction, and the first shot stays unchanged until they hide it completely" },
])

export const AURORA_SWEEP_STYLE: TransitionOption = rowStyle("aurora-sweep", [
  { label: "Sky glow", description: "Aurora light glows over the scene, then fades to reveal the next one",
    phrase: "a luminous curtain of green and violet aurora light ripples across the whole frame, and its bright bands veil the first shot. The camera stays where it is and the framing does not change. As the bands fade, the second shot is revealed behind them. The shot ends on the second shot, clear and fully resolved, with no aurora light left. The aurora glows over the front of the picture, and the second shot appears only as it fades" },
  { slug: "veil", label: "Veil", description: "Aurora curtains drop over the whole picture, then fade to reveal the next scene",
    phrase: "a luminous green and violet aurora curtain ripples across the entire frame, the bright bands obscure the first scene, and as the aurora dissipates the second scene resolves in the clear sky" },
])

export const SAND_STORM_STYLE: TransitionOption = rowStyle("sand-storm", [
  { label: "Full cover", description: "A wall of sand hides the whole picture, then clears on the next scene",
    phrase: "a wall of opaque, swirling ochre sand sweeps in from one side of the frame and surges across it until the whole picture is hidden in dust. The camera stays where it is and the framing does not change. The dust then thins and sinks away toward the lower edge of the frame, revealing the second shot behind it. The shot ends on the second shot, clear and fully resolved, with no dust left. The first shot stays as it is until the sand covers it completely, and the second shot appears only as the dust clears" },
  { slug: "light-sweep", label: "Light sweep", description: "A streak of blown sand crosses the screen with the next scene already behind it",
    phrase: "a narrow streak of blown sand races across the frame close to the lens in one direction. The first shot stays clear ahead of the streak and the second shot is already clear behind it. The camera stays where it is and the framing does not change. The shot ends on the second shot, fully resolved, with no sand left" },
])

export const WHITE_FLASH_STYLE: TransitionOption = rowStyle("white-flash", [
  { label: "Flash", description: "A camera flash pops the picture to white, holds, then fades down on the next scene",
    phrase: "a bright camera-flash bloom fills the whole frame with pure white. The camera stays where it is and the framing does not change. The white holds for a clear beat, then fades down to reveal the second shot. The shot ends on the second shot, fully resolved, with no white haze left. The first shot is gone once the frame is white, and the second shot appears only out of the white" },
  { slug: "overexposure", label: "Overexposure", description: "The picture blooms to white and resolves into the next scene",
    phrase: "a bright camera-flash bloom fills the frame with pure white, holds for a fraction of a second, then resolves into the new scene" },
])

const optionToken = (field: string): string => `{${field}}`

/**
 * Fill a template's option tokens: each option's chosen choice when `values`
 * names one of its ids, its `auto` choice otherwise (an unknown id included).
 */
function fillOptionSlots(
  template: string,
  options: ReadonlyArray<TransitionOption>,
  values?: TransitionOptionValues,
): string {
  let out = template
  for (const option of options) {
    const picked = values?.[option.field]
    const choice =
      option.choices.find((c) => c.id === picked) ?? option.choices[0]
    out = out.split(optionToken(option.field)).join(choice?.phrase ?? "")
  }
  return out
}

/**
 * Author a row that has options: the row is written with its `promptTemplate`,
 * and its `promptHint` is the template on every `auto` choice.
 */
function withOptionSlots(
  row: Omit<Transition, "promptHint"> & {
    readonly promptTemplate: string
    readonly options: ReadonlyArray<TransitionOption>
  },
): Transition {
  return { ...row, promptHint: fillOptionSlots(row.promptTemplate, row.options) }
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
    promptHint: "snap to black: the first shot cuts straight to full black on a single frame. The camera holds its framing right up to the cut. The frame stays pure black for a single beat, then the second shot cuts in at full brightness on a single frame. The shot ends on the second shot, fully resolved", term: "snap to black" , instant: true },
  { id: "match-cut",         label: "Match Cut",         category: "standard", description: "Shape or motion match across shots",
    promptHint: "match cut: the last picture of the first shot and the first picture of the second share one shape, at the same place and the same size in the frame. The camera holds that shape in place across the cut. On the next frame everything around the shape has changed while the shape itself stays put. The shot ends on the second shot, fully resolved, with no flash frame or zoom between the two" , instant: true },
  { id: "smash-cut",         label: "Smash Cut",         category: "standard", description: "Jarring abrupt cut between contrasting shots",
    promptHint: "smash cut: an abrupt jarring transition between two visually or tonally contrasting shots with no fade, on a beat" , instant: true },
  { id: "iris",              label: "Iris",              category: "standard", description: "Circular iris closes, then opens on second",
    promptHint: "iris transition: a circular vignette closes inward over the first shot until the frame is black, then opens outward to reveal the second shot", term: "iris wipe" },
  withOptionSlots({ id: "wipe", label: "Wipe",              category: "standard", description: "Linear wipe replaces first shot",
    promptTemplate: "linear wipe transition: a clean {wipeDirection}, revealing the second shot behind it", term: "linear wipe",
    options: [WIPE_DIRECTION] }),
  { id: "roll-transition",   label: "Roll",              category: "standard", description: "Frame rolls 90-180°, second shot upright on landing",
    promptHint: "the picture rolls around its centre in one smooth, fast turn, blurred by the speed of the turn. The camera stays in the same spot, turning only around its lens axis. During the turn the second shot takes over, and the roll slows and stops with it level and upright. The shot ends on the second shot, level, upright and still. The roll turns one way only and stops once, with no swing back", term: "camera roll transition" },
  { id: "seamless-match",    label: "Seamless Match",    category: "standard", description: "Hidden cut disguised by matched motion and color",
    promptHint: "hidden seamless transition: the camera motion, color palette, and on-screen motion at the end of the first shot continue exactly across the cut into the second shot, so the boundary is invisible and the two shots feel like one unbroken take", term: "invisible cut" , instant: true, blendable: true },
  { id: "whip-pan",          label: "Whip Pan",          category: "standard", description: "Camera whips sideways into blur, next shot rides the same direction",
    promptHint: "whip pan transition: the camera whips sideways at high speed, smearing the frame into heavy horizontal motion blur, and the second shot enters already travelling in the same direction before it settles into its framing", term: "whip pan" },
  { id: "jump-cut",          label: "Jump Cut",          category: "standard", description: "Same framing, time skips forward",
    promptHint: "jump cut: the framing, lens, and camera position stay identical across the cut while time skips abruptly forward, so the subject snaps to a new position inside what still reads as one continuous shot. No leap, no run, no lunge and no motion blur between the two positions; the subject is in the old place on one frame and already in the new place on the next", term: "jump cut" , instant: true },

  // ============================================================================
  // TIME — 8 entries — temporal shifts (same or related scene, different time, or memory)
  // ============================================================================
  { id: "fast-forward-day-night",  label: "Fast-Forward (Day → Night)", category: "time", description: "Time-lapse day to night same scene",
    promptHint: "fast-forward time-lapse transition: the same view with framing locked while hours pass in seconds: light and shadows sweep across the scene, daylight warms to dusk and fades to night, lights come on, until the picture matches the end frame", term: "day-to-night time-lapse" },
  { id: "fast-forward-night-day",  label: "Fast-Forward (Night → Day)", category: "time", description: "Time-lapse night to dawn same scene",
    promptHint: "fast-forward time-lapse transition: stars fade, the sky shifts from deep night through pre-dawn blue to golden sunrise, shadows sweep in reverse, all while framing and camera position remain locked on the same scene", term: "night-to-day time-lapse" },
  { id: "seasonal-shift",          label: "Seasonal Shift",             category: "time", description: "Same scene through changing seasons",
    promptHint: "accelerated seasonal time-lapse: the same view races through the seasons in fast motion, from the season of the first shot to the season of the second, as growing things bud, turn and fall and snow comes or goes. The camera stays where it is and the framing does not change. The change flows continuously across the whole picture, every part moving on together, until the view matches the second shot. The shot ends on the second shot's season, still and fully resolved. Only the season changes, and the layout of the view stays exactly the same", term: "seasonal time-lapse" },
  { id: "aging",                   label: "Aging",                      category: "time", description: "Subject visibly ages forward in time",
    promptHint: "accelerated aging transition: the subject visibly ages forward - fine lines deepen into wrinkles, hair greys to silver, posture settles - while the framing stays unchanged", term: "accelerated aging" },
  { id: "rewind",                  label: "Rewind",                     category: "time", description: "Time reverses, motion plays backward",
    promptHint: "rewind transition: reverse motion: the actions just seen are undone exactly as they happened, in reverse order and at the same pace, the subject retracing each step to where it began, ending on the end frame", term: "reverse-motion rewind" },
  { id: "freeze-frame-jump",       label: "Freeze-Frame Jump",          category: "time", description: "Action freezes, jumps forward in time",
    promptHint: "freeze-frame transition: all motion stops mid-action and the picture holds still for a beat; only then does it jump to the same view hours or days later, everything in new positions, and motion resumes", term: "freeze-frame time jump" },
  { id: "weather-shift",           label: "Weather Shift",              category: "time", description: "Same scene through changing weather",
    promptHint: "accelerated weather transition: same scene, framing locked — clear sky darkens to storm clouds, rain begins and intensifies then clears, sun returns through breaking clouds", term: "weather time-lapse" },
  { id: "flashback",               label: "Flashback",                  category: "time", description: "Memory-flashback into a past moment of the subject",
    promptHint: "brief flashback transition: a soft warm wash spreads over the whole picture and a faint ripple drifts across it as the present moment fades. The camera stays where it is and the framing does not change. Through the ripple an earlier moment of the same subject comes into focus, like a memory. The shot ends on the remembered moment, steady and fully resolved, with the ripple gone. The subject stays at the same place in the frame while the moment around it changes" },

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
  withOptionSlots({ id: "smoke-puff",        label: "Smoke Puff",         category: "element", description: "Subject vanishes in smoke, reappears",
    promptTemplate: "{style}",
    options: [SMOKE_PUFF_STYLE] }),
  { id: "magic-sparkles",    label: "Magic Sparkles",     category: "element", description: "Particle dissolve à la Avengers / apparition",
    promptHint: "the subject disintegrates into a cloud of glowing golden sparkles that scatter outward, then the sparkles converge from across the frame and re-coalesce into the new subject" },
  { id: "lightning-flash",   label: "Lightning Strike",   category: "element", description: "Lightning strikes, scene changes in flash",
    promptHint: "a brilliant jagged bolt of lightning cracks across the frame and its flash turns the whole picture white. The camera stays where it is and the framing does not change. As the flash dies away, the second shot is revealed in its place. The shot ends on the second shot, fully resolved, with no bolt or flash left. The change happens inside the flash, and the second shot appears only as the white fades" },
  { id: "ink-splash",        label: "Ink Splash",         category: "element", description: "Ink splashes across, scene changes",
    promptHint: "black ink splashes across the frame in expanding tendrils that fully cover the image, then the ink retracts inward and pulls back to reveal the new scene" },
  withOptionSlots({ id: "sand-storm",        label: "Sand Storm",         category: "element", description: "Sand storm engulfs the frame, scene changes inside",
    promptTemplate: "{style}",
    options: [SAND_STORM_STYLE] }),
  { id: "paint-splash",      label: "Paint Splash",       category: "element", description: "Vivid paint splash covers, retracts into new scene",
    promptHint: "vivid splashes of coloured paint fly across the frame in arcing streaks and pile over one another until the whole picture is covered in wet paint. The camera stays where it is and the framing does not change. The paint then gathers toward the centre of the frame and shrinks to nothing, uncovering the second shot from the edges inward. The shot ends on the second shot, clean and fully resolved, with no paint left. The paint lies on the surface of the picture itself, and the second shot appears only where the paint has gone" },
  withOptionSlots({ id: "aurora-sweep",      label: "Aurora Sweep",       category: "element", description: "Aurora curtain sweeps across, scene changes behind",
    promptTemplate: "{style}",
    options: [AURORA_SWEEP_STYLE] }),
  withOptionSlots({ id: "sakura-petals",     label: "Sakura Storm",       category: "element", description: "Cherry blossom petals storm across the frame",
    promptTemplate: "{style}", term: "cherry blossom petal storm",
    options: [SAKURA_PETALS_STYLE] }),
  withOptionSlots({ id: "garden-bloom",      label: "Garden Bloom",       category: "element", description: "Flowers bloom outward, parting to reveal new scene",
    promptTemplate: "{style}",
    options: [GARDEN_BLOOM_STYLE] }),
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
    promptHint: "the camera pushes straight at a mirror in the frame. As the lens meets the glass, the mirror's surface turns liquid and rings ripple out across the whole picture, and the camera keeps moving forward through the rippling surface, out the far side into the second shot. Until the lens touches the glass, the mirror keeps its own reflection. The shot ends in the second shot, still and fully resolved, with no ripples left" },
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
    promptHint: "a flash at the exact centre of the frame bursts into a sharp, bright ring that races past every edge in a moment, trailing a smear of motion blur behind its rim and warping the picture as it goes. The camera stays where it is and the picture stays level. The second shot shows only inside the ring and the first only outside it, with the bright ring as the one hard border and no blending anywhere" },
  { id: "punch-into-camera", label: "Punch Into Camera",  category: "physics", description: "Fist strikes camera, scene changes",
    promptHint: "a fist or object swings rapidly toward the camera and strikes the lens with motion blur and impact frames, and the moment of impact reveals the new scene" },
  withOptionSlots({ id: "debris-shower",     label: "Debris Shower",      category: "physics", description: "Debris flies past, scene changes behind",
    promptTemplate: "{style}",
    options: [DEBRIS_SHOWER_STYLE] }),
  { id: "gravity-flip",      label: "Gravity Flip",       category: "physics", description: "Gravity inverts, camera rotates 180",
    promptHint: "gravity inverts and the camera rotates a full 180 degrees as objects and the subject reorient to the new down, settling into the new scene oriented correctly" },
  { id: "building-explosion", label: "Building Explosion", category: "physics", description: "Structure detonates, scene shifts through smoke",
    promptHint: "the largest structure in the frame detonates in a massive fireball, and debris and dust plume outward until they fill the whole picture. The camera stays where it is and the framing does not change. As the dust cloud clears, the second shot is revealed in its place. The shot ends on the second shot, clear and fully resolved, with no dust or debris left. The blast comes from that structure itself, and the second shot appears only as the dust clears" },
  { id: "vehicle-explosion", label: "Vehicle Explosion",  category: "physics", description: "Vehicle detonates in foreground, scene changes behind",
    promptHint: "a vehicle in the frame bursts into a violent explosion of fire and twisted metal, and the fireball billows toward the lens until orange flame fills the whole picture. The camera stays where it is and the framing does not change. The flame gives way to thick smoke, and as the smoke parts the second shot is revealed. The shot ends on the second shot, clear and fully resolved, with no fire or smoke left. The explosion comes from that vehicle itself, and the second shot appears only as the smoke parts" },
  { id: "jump-match",        label: "Jump Match",         category: "physics", description: "Subject jumps, landing matches into new scene",
    promptHint: "the subject launches into a jump, and at the height of the leap the picture cuts to a new place. The camera follows the arc of the jump at the same speed on both sides of the cut, and the subject stays at the same place in the frame. In the second shot the same jump carries on without a break, and the subject comes down and lands in the new place. The shot ends on the subject landed in the second shot, fully resolved", term: "match cut on a jump" , instant: true, blendable: true },
  { id: "hand-swipe",        label: "Hand Swipe",         category: "physics", description: "Hand swipes across lens, scene changes during occlusion",
    promptHint: "a hand sweeps across the camera lens at close range, fully occluding the frame in motion blur for a single beat, and as the hand exits the opposite side the scene has changed to the new setting" },
  { id: "action-relay",      label: "Action Match",      category: "physics", description: "Subject exits on an action and lands in the new scene mid-move",
    promptHint: "match cut on action: the subject exits the frame on a committed action — a stride, a throw, a turn — and enters the new scene on the same beat continuing that movement at matched speed and direction, so the action carries unbroken across the cut", term: "match cut on action" , instant: true },

  // ============================================================================
  // LIGHT — 8 entries — flash and lens FX
  // ============================================================================
  withOptionSlots({ id: "white-flash",       label: "White Flash",        category: "light", description: "Frame blooms to white",
    promptTemplate: "{style}",
    options: [WHITE_FLASH_STYLE] }),
  { id: "lens-flare-swipe",  label: "Lens Flare Swipe",   category: "light", description: "Anamorphic lens flare swipes",
    promptHint: "a horizontal anamorphic lens flare sweeps across the frame from one side to the other, and as it crosses the frame the scene behind it has changed to the new setting" },
  { id: "light-streak",      label: "Light Streak",       category: "light", description: "Light streak wipes across",
    promptHint: "a bright streak of light races across the frame leaving motion-blur trails, and as the streak exits the opposite side the scene is now the new setting" },
  { id: "color-invert",      label: "Color Invert Flash", category: "light", description: "Colors invert briefly",
    promptHint: "the colours of the whole picture turn to their photographic negative in an instant. The camera stays where it is and the framing does not change. The negative holds for a single beat, and when the colours snap back to normal the second shot is in place. The shot ends on the second shot in natural colour, fully resolved. The change of shot happens while the picture is in negative, and the picture stays upright and in place throughout" },
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
    promptHint: "datamosh transition: the first shot's pixels tear loose in square compression blocks and slide sideways across the frame in long smeared streaks. The camera stays where it is and the framing does not change. The blocks pile up into the shapes of the second shot, still in the first shot's colours, until the true colours snap in block by block. The shot ends on the second shot, sharp and fully resolved, with no smears or blocks left. The smear covers the whole frame" },
  { id: "channel-flip",      label: "Channel Flip",       category: "glitch", description: "TV channel flip with static",
    promptHint: "the whole picture breaks into a brief burst of black-and-white static, the image jumping and tearing as if the channel were being changed. The camera stays where it is and the framing does not change. The static clears as quickly as it came, and the second shot snaps in, steady, like the next channel. The shot ends on the second shot, clean and fully resolved, with no static left. The static covers the whole frame, so the picture itself is what changes channel", term: "tv channel flip with static" },
  { id: "hologram-flicker",  label: "Hologram Flicker",   category: "glitch", description: "Hologram-style flicker materialises new scene",
    promptHint: "the first shot breaks into thin lines of cyan light that flicker out from the top down, leaving the frame black. The camera stays where it is and the framing does not change. A bright scan line sweeps down and draws the second shot behind it in flickering cyan lines that steady into natural colour. The shot ends on the second shot, solid and fully resolved, with no scan lines left. The second shot is drawn only on black, never over the first shot" },
  { id: "display-wipe",      label: "Display Wipe",       category: "glitch", description: "Scene compresses into display, expands to new scene",
    promptHint: "the whole first shot shrinks toward the centre of the frame into a small glowing rectangle, then collapses to a bright line and a dot as if its power were cut. The camera stays where it is and the framing does not change. From the dot a line snaps open and widens into a rectangle showing the second shot, which grows until it fills the frame. The shot ends on the second shot, full frame and fully resolved, with no border or scanlines left. The picture itself shrinks and grows on a black field, with the camera holding still throughout", term: "compress into a screen and expand out" },
  { id: "double-exposure",   label: "Double Exposure",    category: "glitch", description: "Two scenes overlay translucent, first fades to second",
    promptHint: "the first subject becomes a crisp silhouette filled solid with the second shot, while the rest of the first shot stays untouched around it. The camera stays where it is and the framing does not change. The silhouette holds for a clear beat, both pictures plainly seen at once, then the first shot around it gives way to the second shot. The shot ends on the second shot alone, fully resolved" },
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

/**
 * The row's hint. With `values`, a row that declares `options` is written with
 * the chosen choices in its template (an absent or unknown choice reads as
 * `auto`, which IS `promptHint`); every other row ignores them.
 *
 * A catalog pack that REWROTE the row's hint owns its words: its text has no
 * token to fill, so it is returned as written and the options add nothing.
 */
export function getTransitionPromptHint(
  id: string | undefined | null,
  values?: TransitionOptionValues,
): string {
  const t = getTransition(id)
  if (!t) return ""
  if (!values || !t.promptTemplate || !t.options?.length) return t.promptHint
  if (t.promptHint !== fillOptionSlots(t.promptTemplate, t.options)) return t.promptHint
  return fillOptionSlots(t.promptTemplate, t.options, values)
}

/** The per-row options a transition declares (`[]` for most rows, an unknown
 *  id and `auto`). Reads through `getTransition`, like every other getter. */
export function getTransitionOptions(
  id: string | undefined | null,
): ReadonlyArray<TransitionOption> {
  return getTransition(id)?.options ?? []
}

/** Every option field any row declares, in catalog order — what a node-data
 *  reader collects into `TransitionOptionValues`. */
export const TRANSITION_OPTION_FIELDS: ReadonlyArray<string> = Array.from(
  new Set(TRANSITIONS.flatMap((t) => (t.options ?? []).map((o) => o.field))),
)

/**
 * Collect `TransitionOptionValues` from a node-data-shaped record: every
 * declared option field whose value is a non-empty string. Validation against
 * a row's choices happens at render (an unknown id reads as `auto`).
 */
export function readTransitionOptionValues(
  data: Readonly<Record<string, unknown>> | undefined | null,
): TransitionOptionValues | undefined {
  if (!data) return undefined
  const out: Record<string, string> = {}
  for (const field of TRANSITION_OPTION_FIELDS) {
    const v = data[field]
    if (typeof v === "string" && v.length > 0) out[field] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
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
 * Whether a pick may become a BLENDED CUT (see `Transition.blendable`): every
 * picked id is a blendable cut. Same lookup and same empty-pick answer as
 * `isInstantTransition`, so a pick is blendable only where it is instant. Like
 * that check, it reads the ids it is given: the composer passes only the ids
 * that contribute a fragment, so a no-op "auto" beside a blendable cut does not
 * stop the blend there (`["auto", "seamless-match"]` given whole is `false`).
 */
export function isBlendableTransition(
  id: string | ReadonlyArray<string> | undefined | null,
): boolean {
  const ids = typeof id === "string" ? [id] : id ? [...id] : []
  if (ids.length === 0) return false
  return ids.every((one) => {
    const t = getTransition(one)
    return t?.instant === true && t.blendable === true
  })
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
function transitionHintBody(id: string, term: string, values?: TransitionOptionValues): string {
  const hint = getTransitionPromptHint(id, values).replace(LEADING_LABEL, "").trim()
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
 * cut" rendered as a dissolve on prod). A non-empty `cutClause` is appended
 * as `; <cutClause>` inside the parentheses — the hard cut's
 * `INSTANT_CUT_CLAUSE`, or a blended cut's `blendedCutClause`. A row whose hint
 * is just its term (or empty) renders as the term alone; an unknown id or
 * "auto" as "".
 */
function transitionFragment(id: string, cutClause: string, values?: TransitionOptionValues): string {
  const term = getTransitionTerm(id)
  if (!term) return ""
  const inner = [transitionHintBody(id, term, values), cutClause]
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
 *
 * `values` are the per-row option choices (`TransitionOptionValues`) — a wipe's
 * direction. The direction registry passes none, so a `direction.transition`
 * wipe reads as `auto`.
 *
 * These bases are always the HARD cut's: a pick here has no duration, so it
 * never becomes a blended cut. The blend exists only where a duration is
 * picked, in `composeTransitionHintFromConnections`.
 */
export function renderTransitionBases(
  ids: ReadonlyArray<string>,
  _mode: PickerHintMode = "full",
  values?: TransitionOptionValues,
): string[] {
  return renderBasesWith(ids, INSTANT_CUT_CLAUSE, values)
}

/** `renderTransitionBases` with the all-instant pick's clause chosen by the
 *  caller — the hard cut's, or a blended cut's. */
function renderBasesWith(
  ids: ReadonlyArray<string>,
  cutClause: string,
  values?: TransitionOptionValues,
): string[] {
  // Only ids that contribute a fragment count — a no-op "auto" beside a cut
  // must not make the pick look non-instant.
  const picked = ids.filter((id) => getTransitionTerm(id).length > 0)
  const instant = isInstantTransition(picked)
  return picked.map((id, i) => transitionFragment(id, instant && i === 0 ? cutClause : "", values))
}

/**
 * THE BLENDED CUT — what a blendable cut becomes when a duration that
 * `blendsCut` (Short) is picked on it: instead of the anti-blend
 * `INSTANT_CUT_CLAUSE`, the two shots blend into each other over that step's
 * own `term` ("about 1 second"), so the time words are the catalog's and never
 * typed here. "" for every other value (auto, instant, medium, long, an unknown
 * id, none), which leaves the cut a hard cut.
 */
export function blendedCutClause(duration: string | undefined): string {
  const row = TRANSITION_DURATIONS.find((d) => d.id === duration) as TransitionTimingOption | undefined
  return row?.blendsCut ? `instead of a hard cut, the two shots blend into each other over ${row.term}` : ""
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
  /** Duration rows only: `true` on a step a blendable CUT may take — picked on
   *  such a pick it turns the cut into a BLENDED CUT over this row's `term`
   *  (see `blendedCutClause`). Absent = a cut ignores the step and stays a
   *  hard cut. Set on `short` only: the 2026-10-04 test round approved the
   *  blend at about 1 second, not at Medium's 2. */
  readonly blendsCut?: boolean
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
  { id: "short",   label: "Short (~1s)",   description: "Approximately 1 second",  promptHint: "lasting approximately 1 second", term: "about 1 second", blendsCut: true },
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
  /** The per-row option choices (a wipe's `wipeDirection`) — see
   *  `Transition.options`. Absent, every row reads as `auto`. */
  readonly optionValues?: TransitionOptionValues
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
 * - A BLENDED CUT: when every picked id is a blendable cut
 *   (`isBlendableTransition`) and the duration `blendsCut` (Short), that
 *   clause is `blendedCutClause(duration)` INSTEAD of `INSTANT_CUT_CLAUSE`
 *   (replaced, not appended; still once, in the first parentheses); every
 *   other rule above stands as for a hard cut, so there is still no duration
 *   clause, no intensity clause and no `full`. Any other duration on such a
 *   pick, and any duration on any other cut, leaves the hard cut
 * - null input is treated like undefined (falsy short-circuit → returns "")
 *
 * @param _mode Accepted for the picker-hint signature; a transition composes
 *   the same text in both modes — each pick as `<term> (<hint body>)`, see
 *   `renderTransitionBases`.
 * @param options `scope: "shot"` when the hint is folded into one shot's time
 *   window of a multi-shot prompt — the position clause then says "of this
 *   shot" instead of "of the clip" (and `full`, on a non-cut, "spans this
 *   entire shot"). Omitted, the wording is the clip's. `optionValues` are the
 *   per-row option choices (a wipe's direction), written into the row's own
 *   description; omitted, every row reads as `auto`.
 */
export function composeTransitionHintFromConnections(
  transitionId: string | ReadonlyArray<string> | undefined,
  startHints: ReadonlyArray<string>,
  endHints: ReadonlyArray<string>,
  timing?: TransitionTiming,
  _mode: PickerHintMode = "full",
  options?: TransitionHintOptions,
): string {
  const ids = Array.isArray(transitionId)
    ? Array.from(new Set(transitionId)).slice(0, 2)
    : transitionId ? [transitionId] : []
  // Same "contributes a fragment" filter `renderTransitionBases` applies.
  const contributing = ids.filter((id) => getTransitionTerm(id).length > 0)
  const instant = isInstantTransition(contributing)
  const blend = instant && isBlendableTransition(contributing) ? blendedCutClause(timing?.duration) : ""
  const baseHints = renderBasesWith(ids, blend || INSTANT_CUT_CLAUSE, options?.optionValues)
  if (baseHints.length === 0) return ""

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
  // pick still has a non-cut to time and shape. (A blended cut's duration has
  // already done its work above, inside the parentheses.)
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
