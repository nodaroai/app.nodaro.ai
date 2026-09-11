/**
 * Canonical catalog of camera motions for video / image-to-video generation.
 *
 * Shared between frontend (picker UI, prompt hint injection) and backend
 * (orchestrator payload builder). The `promptHint` is a natural-language
 * cue that gets appended to the user prompt when the node has camera
 * motion enabled.
 */

import { resolveTerm, type PickerHintMode } from "./term.js"
import { overlayEntry } from "./catalog-overlay.js"
import { joinHintFragments } from "./hint-join.js"

export type CameraMotionCategory =
  | "default"
  | "pan"
  | "tilt"
  | "zoom"
  | "dolly"
  | "truck"
  | "pedestal"
  | "roll"
  | "orbit"
  | "crane"
  | "tracking"
  | "special"

export interface CameraMotion {
  readonly id: string
  readonly label: string
  readonly category: CameraMotionCategory
  readonly description: string
  readonly promptHint: string
  /**
   * Compact professional term for this move ("whip pan left", "push-pull
   * swing") — authored only where the lowercased label is not what a
   * cinematographer would write in a prompt. See `term.ts`.
   */
  readonly term?: string
}

export const CAMERA_MOTIONS: ReadonlyArray<CameraMotion> = [
  // Basic
  {
    id: "auto",
    label: "Auto",
    category: "default",
    description: "Let the model choose appropriate camera motion",
    promptHint: "",
  },
  {
    id: "static",
    label: "Static",
    category: "default",
    description: "Fixed camera, no movement",
    promptHint: "locked off static camera, no camera movement",
    term: "locked-off static camera",
  },
  {
    id: "handheld",
    label: "Handheld",
    category: "default",
    description: "Natural handheld shake",
    promptHint: "handheld camera with subtle natural shake and micro movements",
    term: "handheld camera",
  },
  {
    id: "steadicam",
    label: "Steadicam",
    category: "default",
    description: "Smooth stabilized walking shot",
    promptHint: "smooth steadicam shot, gliding stabilized movement through the scene",
    term: "smooth steadicam shot",
  },

  // Pan — rotation on vertical axis
  {
    id: "pan-left",
    label: "Pan Left",
    category: "pan",
    description: "Rotate camera horizontally to the left",
    promptHint: "The camera stays in exactly the same position and slowly pivots on the spot, rotating its aim to the left like a head turning, sweeping across the scene.\nThe camera does not travel anywhere: its position, its height and its distance to everything in the scene all stay constant, and only its aiming direction changes.\nBecause the camera is rotating rather than moving, there is no parallax at all: near and distant elements slide across the frame together at the same rate, from left to right, with no shift between them.\nThe subject drifts out toward the right edge of the frame as the camera turns away, and new parts of the scene enter from the left.\nNo zoom, no push-in, no sideways travel, no orbiting.",
  },
  {
    id: "pan-right",
    label: "Pan Right",
    category: "pan",
    description: "Rotate camera horizontally to the right",
    promptHint: "The camera stays in exactly the same position and slowly pivots on the spot, rotating its aim to the right like a head turning, sweeping across the scene.\nThe camera does not travel anywhere: its position, its height and its distance to everything in the scene all stay constant, and only its aiming direction changes.\nBecause the camera is rotating rather than moving, there is no parallax at all: near and distant elements slide across the frame together at the same rate, from right to left, with no shift between them.\nThe subject drifts out toward the left edge of the frame as the camera turns away, and new parts of the scene enter from the right.\nNo zoom, no push-in, no sideways travel, no orbiting.",
  },
  {
    id: "whip-pan-left",
    label: "Whip Pan Left",
    category: "pan",
    description: "Fast whip pan left with motion blur",
    promptHint: "The camera stays in exactly the same position and whips violently fast on the spot, snapping its aim to the left in one abrupt blurred sweep across the scene.\nThe camera does not travel anywhere: its position, its height and its distance to everything in the scene all stay constant, and only its aiming direction changes.\nThe rotation is so fast that the whole frame smears into heavy horizontal motion blur and the scene becomes briefly unreadable mid-sweep.\nBecause the camera is rotating rather than moving, there is no parallax at all: near and distant elements streak across the frame together at the same rate, from left to right.\nThe subject is flung out past the right edge of the frame almost immediately.\nNo zoom, no push-in, no sideways travel, no orbiting.",
  },
  {
    id: "whip-pan-right",
    label: "Whip Pan Right",
    category: "pan",
    description: "Fast whip pan right with motion blur",
    promptHint: "The camera stays in exactly the same position and whips violently fast on the spot, snapping its aim to the right in one abrupt blurred sweep across the scene.\nThe camera does not travel anywhere: its position, its height and its distance to everything in the scene all stay constant, and only its aiming direction changes.\nThe rotation is so fast that the whole frame smears into heavy horizontal motion blur and the scene becomes briefly unreadable mid-sweep.\nBecause the camera is rotating rather than moving, there is no parallax at all: near and distant elements streak across the frame together at the same rate, from right to left.\nThe subject is flung out past the left edge of the frame almost immediately.\nNo zoom, no push-in, no sideways travel, no orbiting.",
  },

  // Tilt — rotation on horizontal axis
  {
    id: "tilt-up",
    label: "Tilt Up",
    category: "tilt",
    description: "Tilt camera upward",
    promptHint: "The camera is locked to a tripod head at a fixed point in space and pivots on that head, tilting its aim upward like a head lifting to look higher.\nThe camera's height stays exactly the same for the entire shot, and the tripod stays planted in the same spot: the lens sweeps upward while the camera body itself never rises, never lowers and never travels.\nBecause the camera is rotating rather than moving, there is no parallax at all: near and distant elements slide down the frame together at the same rate, with no shift between them.\nWhatever occupied the bottom of the opening frame slides down and out past the bottom edge, and whatever lay above the top edge is progressively revealed as the aim rises.\nNo zoom, no push-in.",
  },
  {
    id: "tilt-down",
    label: "Tilt Down",
    category: "tilt",
    description: "Tilt camera downward",
    promptHint: "The camera is locked to a tripod head at a fixed point in space and pivots on that head, tilting its aim downward like a head lowering to look lower.\nThe camera's height stays exactly the same for the entire shot, and the tripod stays planted in the same spot: the lens sweeps downward while the camera body itself never rises, never lowers and never travels.\nBecause the camera is rotating rather than moving, there is no parallax at all: near and distant elements slide up the frame together at the same rate, with no shift between them.\nWhatever occupied the top of the opening frame slides up and out past the top edge, and whatever lay below the bottom edge is progressively revealed as the aim lowers.\nNo zoom, no push-in.",
  },

  // Zoom — lens only
  {
    id: "zoom-in",
    label: "Zoom In",
    category: "zoom",
    description: "Lens zoom toward subject",
    promptHint: "The camera is locked to a tripod planted in one spot and never moves at all. Only the lens changes: its focal length slowly increases, magnifying the image so the frame closes in on the subject.\nBecause the camera body does not travel, the perspective of the scene never changes: there is NO parallax whatsoever, nothing slides past anything else, and the spatial relationship between near and distant elements stays exactly as it was.\nEverything in the frame simply grows larger together at the same rate and the edges of the picture crop away, as if the whole photograph were being enlarged from its centre.\nThe subject fills progressively more of the frame while the background behind it flattens and compresses.\nNo camera travel, no dolly, no push-in, no walking forward, no orbiting.",
  },
  {
    id: "zoom-out",
    label: "Zoom Out",
    category: "zoom",
    description: "Lens zoom away from subject",
    promptHint: "The camera is locked to a tripod planted in one spot and never moves at all. Only the lens changes: its focal length slowly decreases, widening the view so the frame opens out away from the subject.\nBecause the camera body does not travel, the perspective of the scene never changes: there is NO parallax whatsoever, nothing slides past anything else, and the spatial relationship between near and distant elements stays exactly as it was.\nEverything in the frame simply shrinks together at the same rate and more of the surroundings enters from all four edges, as if the whole photograph were being reduced towards its centre.\nThe subject fills progressively less of the frame while more and more of the wider environment is revealed around it.\nNo camera travel, no dolly, no pull-back, no walking backward, no orbiting.",
  },
  {
    id: "crash-zoom-in",
    label: "Crash Zoom In",
    category: "zoom",
    description: "Snappy whip-style zoom in",
    promptHint: "The camera is locked to a tripod planted in one spot and never moves at all. Only the lens changes: its focal length rockets up in one violent instant, snapping the frame hard onto the subject.\nThe zoom is so abrupt that the image judders and smears with motion blur during the snap, and the magnification slams to a stop rather than easing in.\nBecause the camera body does not travel, the perspective of the scene never changes: there is NO parallax whatsoever, nothing slides past anything else, and the spatial relationship between near and distant elements stays exactly as it was.\nEverything in the frame simply explodes larger together at the same rate and the edges of the picture crop violently away, as if the photograph were being blown up from its centre in a single jolt.\nNo camera travel, no dolly, no push-in, no walking forward, no orbiting.",
  },
  {
    id: "crash-zoom-out",
    label: "Crash Zoom Out",
    category: "zoom",
    description: "Snappy whip-style zoom out",
    promptHint: "The camera is locked to a tripod planted in one spot and never moves at all. Only the lens changes: its focal length drops away in one violent instant, snapping the frame wide open away from the subject.\nThe zoom is so abrupt that the image judders and smears with motion blur during the snap, and the widening slams to a stop rather than easing out.\nBecause the camera body does not travel, the perspective of the scene never changes: there is NO parallax whatsoever, nothing slides past anything else, and the spatial relationship between near and distant elements stays exactly as it was.\nEverything in the frame simply collapses smaller together at the same rate and a great deal more of the surroundings floods in from all four edges at once, as if the photograph were being shrunk towards its centre in a single jolt.\nNo camera travel, no dolly, no pull-back, no walking backward, no orbiting.",
  },

  // Dolly — physical forward/back
  {
    id: "dolly-in",
    label: "Dolly In",
    category: "dolly",
    description: "Push camera toward subject (parallax)",
    promptHint: "The camera glides steadily FORWARD through the scene, physically travelling deeper into it and closing the distance to the subject. Nothing new is added to the scene; the viewpoint simply advances.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is magnified. The image changes only because the camera has moved to a new place.\nThe gap between the camera and the subject SHRINKS continuously: the subject grows steadily larger in the frame as the camera gets closer, and by the end it is much nearer and much bigger than at the start.\nEVERY part of the scene is in motion together, all of it expanding outward from the centre of the frame as the viewpoint advances, and the only difference between them is how fast: the closer something is to the camera the faster it grows and spreads toward the edges, and the further away it is the more gently and slowly it grows. It is one smooth continuous gradient of speed across every depth in the picture. Nothing anywhere in the frame is frozen or static, and nothing slides forward independently of the rest.\nNo zoom, no change of focal length, no sideways travel, no orbiting, no holding a constant distance, no following alongside.",
  },
  {
    id: "dolly-out",
    label: "Dolly Out",
    category: "dolly",
    description: "Pull camera away (parallax)",
    promptHint: "The camera glides steadily BACKWARD through the scene, physically retreating and opening up the distance to the subject. Nothing new is added to the scene; the viewpoint simply withdraws.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is shrunk optically. The image changes only because the camera has moved to a new place.\nThe gap between the camera and the subject GROWS continuously: the subject becomes steadily smaller in the frame as the camera pulls further away, and by the end it is much further off and much smaller than at the start.\nEVERY part of the scene is in motion together, all of it contracting inward toward the centre of the frame as the viewpoint retreats, and the only difference between them is how fast: the closer something is to the camera the faster it shrinks and slides in from the edges, and the further away it is the more gently and slowly it shrinks. It is one smooth continuous gradient of speed across every depth in the picture. Nothing anywhere in the frame is frozen or static, and nothing slides backward independently of the rest.\nNew foreground elements keep entering from behind the camera at the edges of the frame as it retreats.\nNo zoom, no change of focal length, no sideways travel, no orbiting, no holding a constant distance, no following alongside.",
  },
  {
    id: "dolly-zoom",
    label: "Dolly Zoom",
    category: "dolly",
    description: "Vertigo effect: dolly opposes zoom",
    promptHint: "Two opposite things happen at once, in perfect balance, and the tension between them IS the shot.\nFIRST, the camera body travels steadily FORWARD, physically advancing deeper into the scene and closing the distance to the subject.\nSECOND, at exactly the same time and at exactly the matching rate, the lens widens: the focal length decreases continuously throughout the move.\nBecause the two exactly cancel each other, THE SUBJECT NEVER CHANGES SIZE. It stays locked at the same scale and the same position in the frame from the first moment to the last, as if pinned there, and nothing about it grows or shrinks.\nWhat changes instead is DEPTH. As the camera advances and the lens widens, everything behind the subject appears to travel away from it and settle further and further off, so the distance between the subject and the far background stretches open and keeps stretching. What was close behind the subject ends up looking far behind it. The space reads as progressively deeper and longer, as though it were being drawn out lengthwise, while the subject itself stays exactly as it was.\nThe frame stays perfectly upright and level throughout. The camera never rolls, never tilts, never turns; the horizontal and vertical lines of the scene stay horizontal and vertical the whole time.\nNo cuts, no sideways travel, no orbiting, no rolling, no rotation of the frame, no tilting, and above all no change in the size of the subject.",
  },
  {
    id: "push-in",
    label: "Push In",
    category: "dolly",
    description: "Fast forceful push toward subject",
    promptHint: "The camera surges FORWARD hard and fast, driving deep into the scene and closing the distance to the subject in one assertive rush. Nothing new is added to the scene; the viewpoint simply advances.\nThe move is quick and forceful enough to be felt: the picture takes on a slight motion blur as it rushes in, and the advance carries real momentum rather than drifting gently.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is magnified. The image changes only because the camera has moved to a new place.\nThe gap between the camera and the subject SHRINKS rapidly: the subject swells quickly larger in the frame, and by the end it is far nearer and far bigger than at the start.\nEVERY part of the scene is in motion together, all of it expanding outward from the centre of the frame as the viewpoint advances, and the only difference between them is how fast: the closer something is to the camera the faster it grows and spreads toward the edges, and the further away it is the more gently and slowly it grows. It is one smooth continuous gradient of speed across every depth in the picture. Nothing anywhere in the frame is frozen or static, and nothing slides forward independently of the rest.\nNo zoom, no change of focal length, no sideways travel, no orbiting, no holding a constant distance, no following alongside.",
    term: "fast push-in",
  },
  {
    id: "pull-out",
    label: "Pull Out",
    category: "dolly",
    description: "Fast forceful pull back from subject",
    promptHint: "The camera pulls BACKWARD hard and fast, tearing away from the subject and opening up the distance in one decisive rush. Nothing new is added to the scene; the viewpoint simply withdraws.\nThe move is quick and forceful enough to be felt: the picture takes on a slight motion blur as it rushes back, and the retreat carries real momentum rather than drifting gently.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is shrunk optically. The image changes only because the camera has moved to a new place.\nThe gap between the camera and the subject GROWS rapidly: the subject shrinks quickly in the frame, and by the end it is far away and far smaller than at the start.\nEVERY part of the scene is in motion together, all of it contracting inward toward the centre of the frame as the viewpoint retreats, and the only difference between them is how fast: the closer something is to the camera the faster it shrinks and slides in from the edges, and the further away it is the more gently and slowly it shrinks. It is one smooth continuous gradient of speed across every depth in the picture. Nothing anywhere in the frame is frozen or static, and nothing slides backward independently of the rest.\nNew foreground elements keep entering from behind the camera at the edges of the frame as it retreats.\nNo zoom, no change of focal length, no sideways travel, no orbiting, no holding a constant distance, no following alongside.",
    term: "fast pull-out",
  },
  {
    id: "breathing",
    label: "Breathing Camera",
    category: "dolly",
    description: "Subtle continuous push/pull oscillation",
    promptHint: "The camera breathes: it drifts gently FORWARD a small way, then eases back BACKWARD to about where it began, then forward again, in a slow continuous cycle that repeats several times across the shot, like the rise and fall of quiet breathing. Nothing new is added to the scene; only the viewpoint sways in and out.\nThis reversal is deliberate and is the whole point of the move. There is no pause and no hard stop at either end: the forward drift slows, turns over smoothly, and becomes the backward drift, then turns over again. The cycle is soft and rhythmic, never sharp.\nThe travel each way is small and the pace is slow and organic, never mechanical: the picture stays sharp with no motion blur, and it feels like a handheld operator quietly breathing behind the camera rather than a rig being driven.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is magnified. The image changes only because the camera has swayed to a slightly different place.\nThe gap between the camera and the subject accordingly shrinks a little, then opens a little, then shrinks again: the subject swells and settles gently in the frame in time with the cycle.\nEVERY part of the scene moves together with it, all of it expanding outward from the centre on each drift forward and contracting inward on each drift back, and the only difference between them is how fast: what is closest sways most, what is furthest hardly changes. It is one smooth continuous gradient across every depth. Nothing anywhere is frozen or static.\nNo zoom, no change of focal length, no sideways travel, no orbiting, no cuts.",
  },
  {
    id: "push-pull",
    label: "Push-Pull / Swing",
    category: "dolly",
    description: "Camera swings toward subject then away",
    promptHint: "The camera drives decisively FORWARD a good distance, then reverses and pulls back BACKWARD past where it began, then drives forward again, in a deliberate push-and-pull cycle repeated across the shot. Nothing new is added to the scene; only the viewpoint swings in and out.\nThis reversal is deliberate and is the whole point of the move. Each stroke is firm and purposeful, with real travel behind it and a clear change of direction at each end, as if a rig were being driven in and hauled out again by hand. It is emphatic and mechanical, not gentle or organic, and the swing is far larger and more forceful than a quiet drift.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is magnified. The image changes only because the camera has travelled to a different place.\nThe gap between the camera and the subject accordingly closes sharply, opens up wide, then closes again: the subject looms noticeably larger, falls well back, and looms again in time with the cycle.\nEVERY part of the scene moves together with it, all of it expanding outward from the centre on each drive forward and rushing inward on each pull back, and the only difference between them is how fast: what is closest sweeps most, what is furthest shifts least. It is one smooth continuous gradient across every depth. Nothing anywhere is frozen or static.\nNo zoom, no change of focal length, no sideways travel, no orbiting, no cuts.",
    term: "push-pull swing",
  },
  {
    id: "creep-in",
    label: "Creep-In",
    category: "dolly",
    description: "Imperceptibly slow push-in over time",
    promptHint: "The camera creeps FORWARD almost imperceptibly slowly, edging deeper into the scene by the smallest amount and closing the distance to the subject only very slightly. Nothing new is added to the scene; the viewpoint simply inches forward.\nThe move is so gradual it is barely noticeable moment to moment: the picture stays completely sharp with no motion blur at all, the advance never accelerates, and only by comparing the end against the beginning is it clear the camera moved at all. It creates a slow, quiet, unsettling drift rather than any sense of momentum.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is magnified. The image changes only because the camera has crept to a slightly new place.\nThe gap between the camera and the subject SHRINKS very slightly and very steadily: the subject grows just a little larger in the frame across the whole shot.\nEVERY part of the scene is in motion together, all of it expanding outward from the centre of the frame by tiny degrees as the viewpoint edges forward, and the only difference between them is how fast: what is closest creeps outward most, what is furthest hardly changes at all. It is one smooth continuous gradient across every depth in the picture. Nothing anywhere is frozen or static, and nothing slides forward independently of the rest.\nNo zoom, no change of focal length, no sideways travel, no orbiting, no acceleration, no holding a constant distance.",
    term: "slow creeping push-in",
  },
  {
    id: "creep-out",
    label: "Creep-Out",
    category: "dolly",
    description: "Imperceptibly slow pull-out over time",
    promptHint: "The camera creeps BACKWARD almost imperceptibly slowly, easing away from the scene by the smallest amount and opening the distance to the subject only very slightly. Nothing new is added to the scene; the viewpoint simply inches back.\nThe move is so gradual it is barely noticeable moment to moment: the picture stays completely sharp with no motion blur at all, the retreat never accelerates, and only by comparing the end against the beginning is it clear the camera moved at all. It creates a slow, quiet, unsettling drift rather than any sense of momentum.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is shrunk optically. The image changes only because the camera has crept to a slightly new place.\nThe gap between the camera and the subject GROWS very slightly and very steadily: the subject becomes just a little smaller in the frame across the whole shot.\nEVERY part of the scene is in motion together, all of it contracting inward toward the centre of the frame by tiny degrees as the viewpoint edges back, and the only difference between them is how fast: what is closest creeps inward most, what is furthest hardly changes at all. It is one smooth continuous gradient across every depth in the picture. Nothing anywhere is frozen or static, and nothing slides backward independently of the rest.\nNo zoom, no change of focal length, no sideways travel, no orbiting, no acceleration, no holding a constant distance.",
    term: "slow creeping pull-out",
  },

  // Truck — lateral slide
  {
    id: "truck-left",
    label: "Truck Left",
    category: "truck",
    description: "Slide camera body laterally left",
    promptHint: "The camera glides steadily SIDEWAYS to the left, physically travelling laterally across the scene while continuing to aim straight ahead in exactly the same direction the whole time. It never turns or pivots; its aim stays locked forward and only its position slides left.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is magnified. The camera is passing across the scene, not approaching or retreating.\nThe framing is NOT locked onto anything: nothing is kept centred or held in place. EVERY single thing visible in the opening frame, including whatever sits at its very centre, slides steadily to the right across the picture and eventually passes out past the right edge as the viewpoint travels on past it.\nThe only difference between them is how fast: whatever is closest to the camera sweeps across and off the right edge quickly, things further back drift right more gently, and the most distant parts ease right slowest of all. It is one smooth continuous gradient of speed across every depth. Nothing anywhere is frozen, and nothing travels along with the camera.\nNew elements keep entering from the left edge as the camera advances sideways past them.\nNo zoom, no change of focal length, no turning, no pivoting, no rotation of the aim, no forward or backward travel, no tracking or following.",
  },
  {
    id: "truck-right",
    label: "Truck Right",
    category: "truck",
    description: "Slide camera body laterally right",
    promptHint: "The camera glides steadily SIDEWAYS to the right, physically travelling laterally across the scene while continuing to aim straight ahead in exactly the same direction the whole time. It never turns or pivots; its aim stays locked forward and only its position slides right.\nThe lens never changes: the focal length is fixed for the entire shot, so nothing is magnified. The camera is passing across the scene, not approaching or retreating.\nThe framing is NOT locked onto anything: nothing is kept centred or held in place. EVERY single thing visible in the opening frame, including whatever sits at its very centre, slides steadily to the left across the picture and eventually passes out past the left edge as the viewpoint travels on past it.\nThe only difference between them is how fast: whatever is closest to the camera sweeps across and off the left edge quickly, things further back drift left more gently, and the most distant parts ease left slowest of all. It is one smooth continuous gradient of speed across every depth. Nothing anywhere is frozen, and nothing travels along with the camera.\nNew elements keep entering from the right edge as the camera advances sideways past them.\nNo zoom, no change of focal length, no turning, no pivoting, no rotation of the aim, no forward or backward travel, no tracking or following.",
  },

  // Pedestal — vertical slide
  {
    id: "pedestal-up",
    label: "Pedestal Up",
    category: "pedestal",
    description: "Raise camera body vertically",
    promptHint: "The camera is mounted on a column that raises it straight UPWARD, and it rises vertically, climbing steadily higher. The scene itself is entirely unchanged; nothing in it moves, falls, appears or is added. Only the viewpoint ascends.\nThe camera's aim never changes: it keeps pointing straight ahead at exactly the same angle for the entire shot, perfectly level, never tipping up or down as it climbs. Only its height changes.\nThe lens never changes either: the focal length is fixed, so nothing is magnified.\nBecause the camera physically travels upward, there is STRONG parallax: EVERY part of the scene is in motion together, all of it sliding downward through the frame as the viewpoint climbs, and the only difference between them is how fast. What is nearest the camera sinks and passes out of the bottom edge quickly, what is further back drifts down more gently, and the most distant parts ease down slowest of all. It is one smooth continuous gradient of speed across every depth. Nothing anywhere in the frame is frozen or static.\nWhatever lay above the top edge of the opening frame is revealed as the camera reaches its height, entering from the top and settling into view.\nNo zoom, no change of focal length, no tilting, no tipping the aim upward, no forward or sideways travel.",
  },
  {
    id: "pedestal-down",
    label: "Pedestal Down",
    category: "pedestal",
    description: "Lower camera body vertically",
    promptHint: "The camera is mounted on a column that lowers it straight DOWNWARD, and it descends vertically, sinking steadily lower. The scene itself is entirely unchanged; nothing in it moves, falls, appears or is added. Only the viewpoint descends.\nThe camera's aim never changes: it keeps pointing straight ahead at exactly the same angle for the entire shot, perfectly level, never tipping up or down as it sinks. Only its height changes.\nThe lens never changes either: the focal length is fixed, so nothing is magnified.\nBecause the camera physically travels downward, there is STRONG parallax: EVERY part of the scene is in motion together, all of it sliding upward through the frame as the viewpoint sinks, and the only difference between them is how fast. What is nearest the camera climbs and passes out of the top edge quickly, what is further back drifts up more gently, and the most distant parts ease up slowest of all. It is one smooth continuous gradient of speed across every depth. Nothing anywhere in the frame is frozen or static.\nWhatever lay below the bottom edge of the opening frame is revealed as the camera sinks to its level, entering from the bottom and settling into view.\nNo zoom, no change of focal length, no tilting, no tipping the aim downward, no forward or sideways travel.",
  },

  // Roll — rotation on lens axis
  {
    id: "roll-left",
    label: "Roll Left",
    category: "roll",
    description: "Rotate camera counterclockwise",
    promptHint: "camera rolls counterclockwise around the lens axis",
  },
  {
    id: "roll-right",
    label: "Roll Right",
    category: "roll",
    description: "Rotate camera clockwise",
    promptHint: "camera rolls clockwise around the lens axis",
  },
  {
    id: "dutch-angle",
    label: "Dutch Angle",
    category: "roll",
    description: "Static tilted frame for tension",
    promptHint: "dutch angle, canted tilted frame for tension",
  },
  {
    id: "spin-360",
    label: "Full 360 Spin",
    category: "roll",
    description: "Camera rotates a full 360° on its axis",
    promptHint: "full 360 degree spin, the camera rotates a complete revolution on its own lens axis",
    term: "full 360 degree camera roll",
  },

  // Orbit / Arc
  {
    id: "orbit-left",
    label: "Orbit Left",
    category: "orbit",
    description: "Large partial orbit around subject to the left",
    promptHint: "camera orbits around the subject in a circular path, the background sliding to the left across the frame",
  },
  {
    id: "orbit-right",
    label: "Orbit Right",
    category: "orbit",
    description: "Large partial orbit around subject to the right",
    promptHint: "camera orbits around the subject in a circular path, the background sliding to the right across the frame",
  },
  {
    id: "arc-left",
    label: "Arc Left",
    category: "orbit",
    description: "Partial arc around subject left",
    promptHint: "slow camera arc around the subject through a partial arc, the background sliding to the left across the frame",
  },
  {
    id: "arc-right",
    label: "Arc Right",
    category: "orbit",
    description: "Partial arc around subject right",
    promptHint: "The camera slowly moves sideways to the right while curving around the subject, continuously turning toward the subject to keep the same centered framing.\nThe camera maintains constant distance from the subject.\nAs the viewpoint changes, strong natural parallax is visible: nearby environmental elements shift right noticeably while distant background elements shift right more slowly.\nThe shot ends from a slightly different three-quarter viewing angle.\nNo zoom, no push-in, no pull-out.",
  },
  {
    id: "orbit-360",
    label: "Full 360 Orbit",
    category: "orbit",
    description: "Full circular arc around subject",
    promptHint: "The camera moves sideways to the right while curving around the subject, continuously turning toward the subject to keep the same centered framing, and keeps travelling in the same direction without pausing until it has passed the subject's right side, then behind it, then its left side, and comes back to where it began.\nThe camera maintains constant distance and constant height from the subject throughout.\nAs the viewpoint changes, strong natural parallax is visible: nearby environmental elements sweep right past the frame edge while distant background elements shift right more slowly, and every part of the surroundings passes behind the subject in turn, until whatever was behind it at the start is behind it again at the end.\nThe shot ends on the exact same viewpoint and composition it started from, having circled the subject completely.\nNo zoom, no push-in, no pull-out, no reversal of direction.",
    term: "full orbit, one complete circle around the subject",
  },

  // Crane / Jib
  {
    id: "crane-up",
    label: "Crane Up",
    category: "crane",
    description: "Sweeping crane rise revealing scene",
    promptHint: "The camera is carried on the end of a long jib arm that swings it UPWARD and OUTWARD through a rising arc, so it climbs steadily higher and at the same time draws back and away from where it started. The scene itself is entirely unchanged; nothing in it moves, falls, appears or is added. Only the viewpoint travels.\nUnlike a straight vertical lift, the aim DOES change: as the camera rises it tips gradually downward, angling more and more steeply so that what began level with it is now looked down upon from above. The rise and the tilt happen together as one continuous sweeping arc.\nThe lens never changes: the focal length is fixed, so nothing is magnified.\nBecause the camera physically travels, there is STRONG parallax: EVERY part of the scene is in motion together, sliding downward and outward through the frame as the viewpoint climbs and pulls back, and the only difference between them is how fast. What is nearest the camera sweeps down and out of the bottom edge quickly, what is further back drifts more gently, and the most distant parts ease slowest of all. It is one smooth continuous gradient of speed across every depth. Nothing anywhere in the frame is frozen or static.\nThe shot ends on a high, wide, elevated vantage looking down over the whole scene, far above and behind where it began.\nNo zoom, no change of focal length, no sideways drift, no orbiting.",
  },
  {
    id: "crane-down",
    label: "Crane Down",
    category: "crane",
    description: "Sweeping crane descent",
    promptHint: "The camera is carried on the end of a long jib arm that swings it DOWNWARD and INWARD through a descending arc, so it drops steadily lower and at the same time closes in toward what lay beneath it. The scene itself is entirely unchanged; nothing in it moves, falls, appears or is added. Only the viewpoint travels.\nUnlike a straight vertical descent, the aim DOES change: as the camera drops it tips gradually upward, levelling out more and more, so that what was looked down upon from above is now met at its own level. The fall and the tilt happen together as one continuous sweeping arc.\nThe lens never changes: the focal length is fixed, so nothing is magnified.\nBecause the camera physically travels, there is STRONG parallax: EVERY part of the scene is in motion together, sliding upward and inward through the frame as the viewpoint drops and closes in, and the only difference between them is how fast. What is nearest the camera sweeps up and out of the top edge quickly, what is further back drifts more gently, and the most distant parts ease slowest of all. It is one smooth continuous gradient of speed across every depth. Nothing anywhere in the frame is frozen or static.\nThe shot ends on a low, close vantage, far below and ahead of where it began.\nNo zoom, no change of focal length, no sideways drift, no orbiting.",
  },
  {
    id: "boom-up",
    label: "Boom Up",
    category: "crane",
    description: "Boom arm rise",
    promptHint: "boom up, camera lifts on a boom arm while keeping subject framed",
  },
  {
    id: "boom-down",
    label: "Boom Down",
    category: "crane",
    description: "Boom arm descent",
    promptHint: "boom down, camera lowers on a boom arm while keeping subject framed",
  },

  // Tracking / Follow
  {
    id: "tracking-shot",
    label: "Tracking Shot",
    category: "tracking",
    description: "Camera tracks moving subject alongside",
    promptHint: "tracking shot, camera moves alongside the subject keeping them in frame",
  },
  {
    id: "follow",
    label: "Follow",
    category: "tracking",
    description: "Follow subject from behind",
    promptHint: "follow shot, camera trails the subject from behind at a constant distance",
    term: "follow shot from behind",
  },
  {
    id: "lead",
    label: "Lead",
    category: "tracking",
    description: "Move ahead of advancing subject",
    promptHint: "lead shot, camera moves backward ahead of the advancing subject",
    term: "leading tracking shot",
  },
  {
    id: "drone-follow",
    label: "Drone Follow",
    category: "tracking",
    description: "Elevated drone tracking subject",
    promptHint: "aerial drone follow shot, elevated camera smoothly tracking the subject from above and behind",
    term: "aerial drone follow shot",
  },
  {
    id: "dolly-track",
    label: "Dolly Track",
    category: "tracking",
    description: "Dolly on parallel track alongside subject",
    promptHint: "dolly on a parallel track alongside the subject, smooth lateral tracking with strong foreground parallax",
    term: "parallel dolly tracking shot",
  },
  {
    id: "gimbal-walk",
    label: "Gimbal Walk",
    category: "tracking",
    description: "Smooth walking shot on a 3-axis gimbal",
    promptHint: "gimbal walk, smooth walking shot on a 3-axis gimbal with floating steady forward motion",
    term: "smooth gimbal walking shot",
  },
  {
    id: "ronin-glide",
    label: "Ronin Glide",
    category: "tracking",
    description: "Slow gliding move on a Ronin/Movi gimbal",
    promptHint: "ronin glide, slow gliding move on a Ronin or Movi gimbal, cinematic float without any shake",
    term: "slow gliding gimbal move",
  },
  {
    id: "serpentine",
    label: "Serpentine Track",
    category: "tracking",
    description: "Camera weaves through obstacles in S-curves",
    promptHint: "serpentine track, the camera weaves through obstacles in S-curves, snaking forward along a winding path",
    term: "serpentine tracking shot",
  },

  // Special angles / rigs
  {
    id: "pov",
    label: "POV",
    category: "special",
    description: "First person point of view",
    promptHint: "POV shot, first person perspective as seen through the subject's eyes",
    term: "first person pov shot",
  },
  {
    id: "over-the-shoulder",
    label: "Over The Shoulder",
    category: "special",
    description: "Frame past a character's shoulder",
    promptHint: "over the shoulder shot, framing past one character's shoulder onto another",
    term: "over-the-shoulder shot",
  },
  {
    id: "birds-eye",
    label: "Bird's Eye",
    category: "special",
    description: "Direct top-down overhead view",
    promptHint: "bird's eye view, direct overhead top-down shot looking straight down",
    term: "bird's eye view",
  },
  {
    id: "worms-eye",
    label: "Worm's Eye",
    category: "special",
    description: "Extreme low angle looking up",
    promptHint: "worm's eye view, extreme low angle looking up at the subject",
    term: "worm's eye view",
  },
  {
    id: "aerial",
    label: "Aerial",
    category: "special",
    description: "High altitude drone-style shot",
    promptHint: "aerial drone shot, high altitude slow forward movement over the landscape",
    term: "high altitude aerial drone shot",
  },
  {
    id: "helicopter",
    label: "Helicopter",
    category: "special",
    description: "Wide high-altitude sweeping aerial",
    promptHint: "helicopter shot, high altitude wide sweeping aerial pass with strong lateral movement",
    term: "sweeping helicopter aerial shot",
  },
  {
    id: "fly-over",
    label: "Fly Over",
    category: "special",
    description: "Low fast aerial pass over the scene",
    promptHint: "fly over shot, low altitude drone passing quickly over the scene with strong forward motion",
    term: "low aerial fly-over pass",
  },
  {
    id: "flythrough",
    label: "Flythrough",
    category: "special",
    description: "Camera flies through space",
    promptHint: "flythrough shot, camera moving forward through the environment, weaving through obstacles",
    term: "flythrough shot",
  },
  {
    id: "reveal",
    label: "Reveal",
    category: "special",
    description: "Gradually reveal wider scene",
    promptHint: "reveal shot, camera rises and tilts to gradually reveal the subject and wider scene",
    term: "rising reveal shot",
  },
  {
    id: "snorricam",
    label: "Snorricam",
    category: "special",
    description: "Body-mounted camera (subject locked to frame)",
    promptHint: "snorricam body-mounted shot, subject locked in frame while the world moves around them",
    term: "body-mounted snorricam shot",
  },
  {
    id: "rack-focus",
    label: "Rack Focus",
    category: "special",
    description: "Pull focus between foreground and background",
    promptHint: "rack focus, lens focus shifts from a foreground subject to a background subject (or vice versa), the unfocused plane blurs",
  },

  // Modern / social-video vocabulary
  {
    id: "handheld-vlog",
    label: "Handheld Vlog",
    category: "default",
    description: "Casual vlog-style handheld",
    promptHint: "casual handheld vlog-style camera, slight wandering and natural shake, talking-to-camera framing",
    term: "handheld vlog-style camera",
  },
  {
    id: "pov-walk",
    label: "POV Walk",
    category: "tracking",
    description: "First-person walking POV",
    promptHint: "first-person POV walking camera, GoPro-style head-mounted perspective with natural footstep movement",
    term: "first person walking pov",
  },
  {
    id: "velocity-edit",
    label: "Velocity Edit",
    category: "special",
    description: "TikTok speed-ramp pacing",
    promptHint: "rapid speed-ramped camera move with characteristic TikTok velocity-edit pacing, dynamic acceleration into and out of the shot",
    term: "rapid speed-ramped camera move",
  },
  {
    id: "match-cut-zoom",
    label: "Match Cut Zoom",
    category: "zoom",
    description: "Fast zoom that hard-cuts to a matching shape",
    promptHint: "A match cut built on a zoom, in two shots joined by one hard cut.\nShot one: the camera is locked to a tripod and never travels; only the lens changes, its focal length rapidly increasing so the frame rushes in and closes tightly on a single round shape at the centre of the picture, until that circular shape fills almost the whole frame.\nAt the moment the round shape fills the frame there is one HARD CUT.\nShot two: a completely different place and time, but a round shape of the same size sits in exactly the same position at the centre of the frame, so the two shots lock together on that shape and the eye reads it as one continuous movement. The camera continues the same inward push for a moment before settling.\nThe two shots share only the shape and its position; the location, the light and everything else are entirely different.\nNo camera travel in either shot, no dolly, no orbiting.",
  },
  {
    id: "screen-tap",
    label: "Screen Tap",
    category: "special",
    description: "On-screen finger-tap transition",
    promptHint: "camera transition triggered by an on-screen finger tap, TikTok-native pacing with snap to the next subject",
    term: "on-screen finger-tap transition",
  },
  {
    id: "phone-flip",
    label: "Phone Flip",
    category: "special",
    description: "Front/rear camera flip",
    promptHint: "camera-flip transition where the phone visibly rotates between the front and rear sensors, brief blur during the swap",
    term: "front-to-rear phone camera flip",
  },
  {
    id: "gentle-drift",
    label: "Gentle Drift",
    category: "default",
    description: "Slow ambient floating motion",
    promptHint: "gentle camera drift, a slow ambient floating motion with no specific direction, the camera barely moves but never sits perfectly still, evocative of contemplative atmospheric shots",
    term: "slow gentle camera drift",
  },
  {
    id: "parallax",
    label: "Parallax",
    category: "default",
    description: "Lateral motion with foreground/background depth separation",
    promptHint: "parallax camera motion, lateral movement that emphasizes the depth separation between foreground and background elements, foreground objects appearing to move faster than distant ones",
    term: "lateral parallax camera move",
  },
]

export const CAMERA_MOTION_CATEGORY_ORDER: ReadonlyArray<CameraMotionCategory> = [
  "default",
  "pan",
  "tilt",
  "zoom",
  "dolly",
  "truck",
  "pedestal",
  "roll",
  "orbit",
  "crane",
  "tracking",
  "special",
]

export const CAMERA_MOTION_CATEGORY_LABELS: Record<CameraMotionCategory, string> = {
  default: "Basic",
  pan: "Pan",
  tilt: "Tilt",
  zoom: "Zoom",
  dolly: "Dolly",
  truck: "Truck",
  pedestal: "Pedestal",
  roll: "Roll",
  orbit: "Orbit & Arc",
  crane: "Crane & Boom",
  tracking: "Tracking",
  special: "Angles & Rigs",
}

const motionById = new Map<string, CameraMotion>(
  CAMERA_MOTIONS.map((m) => [m.id, m]),
)

export function getCameraMotion(id: string | undefined | null): CameraMotion | undefined {
  if (!id) return undefined
  return overlayEntry("camera-motions", id, motionById.get(id))
}

/** Human-readable label for the given motion id. Falls back to the id if unknown. */
export function getCameraMotionLabel(id: string | undefined | null, fallback?: string): string {
  const m = getCameraMotion(id)
  if (m) return m.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Descriptive prompt hint for the given motion id. Empty string when motion is "auto" or unknown. */
export function getCameraMotionPromptHint(id: string | undefined | null): string {
  return getCameraMotion(id)?.promptHint ?? ""
}

/**
 * Compact counterpart of `getCameraMotionPromptHint`: the short professional
 * term a cinematographer would write for this move ("whip pan left",
 * "push-pull swing") where the hint is the full mechanism sentence. Same
 * lookup and same empty-string-on-miss behavior, so the two getters can never
 * disagree about which motion they describe; "auto" (which injects nothing)
 * resolves to "" here too.
 */
export function getCameraMotionTerm(id: string | undefined | null): string {
  return resolveTerm(getCameraMotion(id))
}

export const CAMERA_MOTION_IDS: ReadonlyArray<string> = CAMERA_MOTIONS.map((m) => m.id)

// ---------------------------------------------------------------------------
// Graph-aware composer — start/end input handles
// ---------------------------------------------------------------------------

/**
 * Compose a structural prompt-hint sentence from a camera-motion id plus
 * arrays of start-state and end-state promptHints (collected by walking
 * the source camera-motion node's startState / endState input handles
 * upstream to find connected parameter nodes).
 *
 * - No connected nodes → bare motion promptHint.
 * - Start only → "<motion>, beginning with <start hints joined>".
 * - End only → "<motion>, ending with <end hints joined>".
 * - Both → "<motion>, beginning with <start>, ending with <end>".
 *
 * Hints within each side are joined with " and " for grammatical flow. The
 * clauses attach with a comma after a clause-style motion hint and with a
 * space after one that already ends a sentence (see `joinHintFragments`).
 * If multiple nodes are connected (e.g. Framing + Lighting + Tone), all
 * three contribute their hint to the clause.
 *
 * @param mode `"compact"` delegates to `composeCameraMotionTermFromConnections`
 *   — the same start/end structure built from the motion's short professional
 *   `term`. The caller is expected to have resolved the connected nodes to
 *   THEIR terms too, so the whole fragment stays at one level of detail.
 */
export function composeCameraMotionHintFromConnections(
  motionId: string | undefined,
  startHints: ReadonlyArray<string>,
  endHints: ReadonlyArray<string>,
  mode: PickerHintMode = "full",
): string {
  if (mode === "compact") {
    return composeCameraMotionTermFromConnections(motionId, startHints, endHints)
  }
  const base = getCameraMotionPromptHint(motionId)
  if (!base) return ""
  const parts: string[] = [base]
  const startClause = startHints.filter((h) => h && h.length > 0).join(" and ")
  const endClause = endHints.filter((h) => h && h.length > 0).join(" and ")
  if (startClause) parts.push(`beginning with ${startClause}`)
  if (endClause) parts.push(`ending with ${endClause}`)
  return joinHintFragments(parts)
}

/**
 * Compact-mode mirror of `composeCameraMotionHintFromConnections`: the same
 * start/end structure, built from the motion's short `term` and the connected
 * parameter nodes' terms instead of their full promptHints
 * ("dolly in, beginning with wide shot, ending with medium close-up").
 *
 * Same shape in every respect — empty base (an "auto" or unknown motion) still
 * yields "", each side is joined with " and ", and the clauses are appended in
 * start-then-end order.
 */
export function composeCameraMotionTermFromConnections(
  motionId: string | undefined,
  startTerms: ReadonlyArray<string>,
  endTerms: ReadonlyArray<string>,
): string {
  const base = getCameraMotionTerm(motionId)
  if (!base) return ""
  const parts: string[] = [base]
  const startClause = startTerms.filter((t) => t && t.length > 0).join(" and ")
  const endClause = endTerms.filter((t) => t && t.length > 0).join(" and ")
  if (startClause) parts.push(`beginning with ${startClause}`)
  if (endClause) parts.push(`ending with ${endClause}`)
  return parts.join(", ")
}
