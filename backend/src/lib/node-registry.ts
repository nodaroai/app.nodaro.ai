import type { OutputType } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../ee/billing/credits.js"
import {
  IMAGE_GEN_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
} from "@nodaro/shared"

export type NodeCategory =
  | "input"
  | "parameter"
  | "ai-image"
  | "ai-video"
  | "ai-audio"
  | "ai-text"
  | "processing"
  | "composition"
  | "trigger"
  | "output"
  | "control"
  | "entity"
  | "utility"

export interface NodeDescriptor {
  type: string
  label: string
  category: NodeCategory
  description: string
  outputType: OutputType | "none"
  /** Credit cost; undefined if free. May be a range like "1-8" if model-dependent. */
  creditCost?: number | string
  /** Input fields the node exposes for user override (subset of full config). */
  inputSchema?: { fields: Array<{ key: string; type: string; required?: boolean; options?: string[] }> }
  /** For AI nodes: list of provider IDs supported. */
  providers?: string[]
  /** Capabilities flags (e.g. "supports-reference-image", "supports-end-frame"). */
  capabilities?: string[]
}

/**
 * Hand-curated registry. Source of truth for `GET /v1/nodes`.
 * Add new entries when adding a new node type — see CLAUDE.md "New Node Registration".
 */
export const NODE_REGISTRY: NodeDescriptor[] = [
  {
    type: "text-prompt",
    label: "Text Prompt",
    category: "input",
    description: "User-supplied text prompt. Connect to AI nodes' prompt input.",
    outputType: "text",
    inputSchema: { fields: [{ key: "text", type: "text", required: true }] },
  },
  {
    type: "upload-image",
    label: "Upload Image",
    category: "input",
    description: "Upload an image asset. Output is the image URL.",
    outputType: "image",
    inputSchema: { fields: [{ key: "url", type: "image-url", required: true }] },
  },
  {
    type: "upload-video",
    label: "Upload Video",
    category: "input",
    description: "Upload a video asset.",
    outputType: "video",
    inputSchema: { fields: [{ key: "url", type: "video-url", required: true }] },
  },
  {
    type: "upload-audio",
    label: "Upload Audio",
    category: "input",
    description: "Upload an audio asset.",
    outputType: "audio",
    inputSchema: { fields: [{ key: "url", type: "audio-url", required: true }] },
  },

  {
    type: "generate-image",
    label: "Generate Image",
    category: "ai-image",
    description: "Generate an image from a text prompt using an AI provider.",
    outputType: "image",
    creditCost: "1-8",
    providers: [...IMAGE_GEN_PROVIDERS],
    capabilities: ["supports-reference-image", "supports-aspect-ratio"],
    inputSchema: {
      fields: [
        { key: "prompt", type: "text", required: true },
        { key: "provider", type: "select", options: [...IMAGE_GEN_PROVIDERS] },
        { key: "aspectRatio", type: "select" },
      ],
    },
  },
  {
    type: "image-to-video",
    label: "Image to Video",
    category: "ai-video",
    description: "Animate a still image into a video.",
    outputType: "video",
    creditCost: "10-125",
    providers: [...IMAGE_TO_VIDEO_PROVIDERS],
    capabilities: ["supports-end-frame", "supports-duration"],
    inputSchema: {
      fields: [
        { key: "imageUrl", type: "image-url", required: true },
        { key: "prompt", type: "text" },
        { key: "provider", type: "select", options: [...IMAGE_TO_VIDEO_PROVIDERS] },
        { key: "duration", type: "number" },
      ],
    },
  },
  {
    type: "text-to-video",
    label: "Text to Video",
    category: "ai-video",
    description: "Generate video from a text prompt.",
    outputType: "video",
    creditCost: "10-125",
    providers: [...TEXT_TO_VIDEO_PROVIDERS],
    inputSchema: {
      fields: [
        { key: "prompt", type: "text", required: true },
        { key: "provider", type: "select", options: [...TEXT_TO_VIDEO_PROVIDERS] },
      ],
    },
  },
  {
    type: "text-to-speech",
    label: "Text to Speech",
    category: "ai-audio",
    description: "Synthesize speech from text using ElevenLabs.",
    outputType: "audio",
    creditCost: 4,
    providers: ["eleven_v3", "eleven_turbo_v2_5", "eleven_multilingual_v2"],
    inputSchema: {
      fields: [
        { key: "text", type: "text", required: true },
        { key: "voiceId", type: "text" },
        { key: "model", type: "select", options: ["eleven_v3", "eleven_turbo_v2_5", "eleven_multilingual_v2"] },
      ],
    },
  },
  {
    type: "generate-music",
    label: "Generate Music",
    category: "ai-audio",
    description: "Generate music with Suno.",
    outputType: "audio",
    creditCost: "7-13",
    providers: ["suno-v4", "suno-v5"],
  },
  {
    type: "suno-voice",
    label: "Suno Voice Persona",
    category: "ai-audio",
    description:
      "Create a custom Suno voice persona from a short recording. Configured once via a setup modal that runs the 2-step KIE voice/validate + voice/generate flow; emits a voiceId for use as personaId in suno-generate / suno-cover / suno-extend.",
    outputType: "none",
    creditCost: 20,
  },
  {
    type: "ai-writer",
    label: "AI Agent",
    category: "ai-text",
    description: "LLM-powered text generation. Stream-capable.",
    outputType: "text",
    creditCost: 5,
  },

  {
    type: "face-swap",
    label: "Face Swap",
    category: "ai-video",
    description: "Replace the face in a video with a face from a reference image.",
    outputType: "video",
    creditCost: 16,
    providers: ["roop"],
    inputSchema: {
      fields: [
        { key: "faceImageUrl", type: "image-url", required: true },
        { key: "videoUrl", type: "video-url", required: true },
      ],
    },
  },

  {
    type: "generate-mask",
    label: "Generate Mask",
    category: "ai-image",
    description: "Produce a binary segmentation mask for a subject described by a text prompt (Grounded SAM).",
    outputType: "image",
    creditCost: 2,
    providers: ["grounded-sam"],
    capabilities: ["segmentation", "inpainting-prep"],
    inputSchema: {
      fields: [
        { key: "imageUrl", type: "image-url", required: true },
        { key: "prompt", type: "text", required: true },
      ],
    },
  },

  { type: "combine-videos", label: "Combine Videos", category: "processing", description: "Concatenate multiple videos.", outputType: "video" },
  { type: "merge-video-audio", label: "Merge Video + Audio", category: "processing", description: "Mux a video and an audio track.", outputType: "video" },
  { type: "trim-video", label: "Trim Video", category: "processing", description: "Trim a video by start/end seconds.", outputType: "video" },
  { type: "resize-video", label: "Resize Video", category: "processing", description: "Resize a video.", outputType: "video" },
  { type: "extract-frame", label: "Extract Frame", category: "processing", description: "Extract a single frame as an image.", outputType: "image" },
  { type: "add-captions", label: "Add Captions", category: "processing", description: "Burn captions into a video. Static (subtitle) is FFmpeg/free; kinetic styles (word-highlight, karaoke, tiktok-words, word-pop, bouncy) render via Remotion at 5 credits.", outputType: "video", creditCost: "0-5" },
  { type: "speed-ramp", label: "Adjust Speed", category: "processing", description: "Change playback speed (0.05x to 100x), reverse, choose audio treatment (pitch-preserve / pitch-shift / drop), opt into motion-compensated frame interpolation (smooth slow-mo), or define a piecewise speed ramp via segments. FFmpeg only.", outputType: "video", creditCost: "2-5" },

  { type: "render-video", label: "Render Video", category: "composition", description: "Render a Remotion composition to MP4.", outputType: "video", creditCost: 15 },
  { type: "after-effects", label: "After Effects", category: "composition", description: "AI-generated post-processing layer.", outputType: "video", creditCost: 2 },
  { type: "motion-graphics", label: "Motion Graphics", category: "composition", description: "AI-generated 2D motion graphics.", outputType: "video", creditCost: 2 },
  { type: "3d-title", label: "3D Title", category: "composition", description: "AI-generated 3D animated text.", outputType: "video", creditCost: 15 },

  { type: "webhook-trigger", label: "Webhook Trigger", category: "trigger", description: "Trigger the workflow via HTTP POST.", outputType: "data" },
  { type: "schedule-trigger", label: "Schedule Trigger", category: "trigger", description: "Trigger the workflow on a cron/interval.", outputType: "data" },

  { type: "save-to-storage", label: "Save to Storage", category: "output", description: "Persist a node output to user storage.", outputType: "none" },
  { type: "webhook-output", label: "Webhook Output", category: "output", description: "POST a node output to a URL.", outputType: "none" },

  { type: "list", label: "List", category: "control", description: "Static list of items for fan-out.", outputType: "data" },
  { type: "loop", label: "Loop", category: "control", description: "Multi-column loop / table.", outputType: "data" },
  { type: "combine-text", label: "Combine Text", category: "control", description: "Concatenate text inputs.", outputType: "text" },
  { type: "split-text", label: "Split Text", category: "control", description: "Split text by delimiter.", outputType: "text" },
  { type: "sub-workflow", label: "Sub-Workflow", category: "control", description: "Embed another workflow as a node. Selects a route (matched input+output pair) on the referenced workflow; ports become handles on the parent canvas. Expand opens the child for editing with a breadcrumb back to the parent.", outputType: "data", creditCost: 0 },
  { type: "sub-workflow-input", label: "Sub-Workflow Input", category: "control", description: "Entry boundary of a callable sub-workflow route. Declares per-port handles consumed by nodes inside the sub-workflow.", outputType: "data", creditCost: 0 },
  { type: "sub-workflow-output", label: "Sub-Workflow Output", category: "control", description: "Exit boundary of a callable sub-workflow route. Declares per-port handles collected from inner nodes and returned to the caller.", outputType: "none", creditCost: 0 },

  { type: "character", label: "Character", category: "entity", description: "Reusable character — portrait, expressions, poses, motion clips, voice & personality, edited in the full-screen Character Studio.", outputType: "data" },
  { type: "face", label: "Face", category: "entity", description: "Reusable face reference.", outputType: "data" },
  { type: "object", label: "Object", category: "entity", description: "Reusable object reference.", outputType: "data" },
  { type: "location", label: "Location", category: "entity", description: "Reusable location reference.", outputType: "data" },

  {
    type: "generative-pipeline",
    label: "Story → Video",
    category: "composition",
    description: "Conversational pipeline: prompt + duration + format → editable film graph. Runs in the pipeline orchestrator, not the workflow DAG.",
    outputType: "video",
    creditCost: 30,
    inputSchema: {
      fields: [
        { key: "story_prompt", type: "text", required: true },
        { key: "target_duration_seconds", type: "number", required: true },
        { key: "format", type: "select", required: true, options: ["trailer", "short_film", "music_video", "reel", "commercial"] },
        { key: "output_resolution", type: "select", options: ["720p", "1080p", "4K"] },
        { key: "mode", type: "select", options: ["manual", "auto"] },
      ],
    },
    capabilities: ["runs-in-pipeline-engine", "requires-edition-cloud"],
  },

  {
    type: "scene",
    label: "Scene",
    category: "composition",
    description: "Structured scene container with shot list, camera, motion. Pipeline-managed — populated by the Scene Director LLM and animated by the pipeline orchestrator (Phase 1C). Outputs: composite_video / last_frame / audio_track. Not directly user-editable in 1B.2; users approve/reject scenes via the pipeline panel.",
    outputType: "video",
    creditCost: 0,
    inputSchema: { fields: [] },
    capabilities: ["runs-in-pipeline-engine", "requires-edition-cloud"],
  },

  { type: "music-genre",     label: "Music Genre",     category: "parameter", description: "Pick a music genre (single or up to 3 for fusion) with optional subgenre and era. Emits a prompt-hint for Suno/MiniMax/Text-to-Audio.", outputType: "text" },
  { type: "music-mood",      label: "Music Mood",      category: "parameter", description: "Pick energy + emotion + vibe for music generation.", outputType: "text" },
  { type: "instrumentation", label: "Instrumentation", category: "parameter", description: "Pick instruments (up to 5) + production style + vocal presence (up to 3) + singing style (up to 3). 'instrumental' vocal-presence flips MiniMax instrumental flag.", outputType: "text" },
  { type: "voice-character", label: "Voice Character", category: "parameter", description: "Pick age + gender + language (up to 3 for multilingual) + accent + timbre for ElevenLabs Voice Design.", outputType: "text" },
  { type: "voice-delivery",  label: "Voice Delivery",  category: "parameter", description: "Pick pace + emotion + archetype for ElevenLabs Voice Design.", outputType: "text" },

  // ---- Look family (15) — visual style, look, mood, atmosphere ----
  { type: "setting",              label: "Setting",              category: "parameter", description: "Pick a setting from 63 entries across 4 categories (indoor, urban, nature, fantastical). Emits a setting-description prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "atmosphere",           label: "Atmosphere",           category: "parameter", description: "Pick an atmospheric condition from 40 entries (clear, fog, dust, rain, snow, smoke, ...). Emits an atmosphere prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "style",                label: "Style",                category: "parameter", description: "Pick a style preset from 48 entries (cinematic, anime, oil-painting, photoreal, ...). Emits a style-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "color-look",           label: "Color / Look",         category: "parameter", description: "Pick a color-grading look from 41 entries (warm, teal-orange, bleached, vintage, ...). Emits a color-grading prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "mood",                 label: "Mood",                 category: "parameter", description: "Pick a mood from 50 entries (calm, tense, melancholic, joyful, ominous, ...). Emits a mood/emotion prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "photographer",         label: "Photographer / Artist",category: "parameter", description: "Pick from 67 photographers, artists, directors, illustrators, or painters (Tim Walker, Deakins, Lubezki, Ghibli, Rutkowski, ...). Emits a 'style of X' prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "aesthetic",            label: "Aesthetic / Microtrend",category:"parameter", description: "Pick a microtrend aesthetic from 46 entries (y2k, cottagecore, vaporwave, dark-academia, ...). Emits an aesthetic-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "era",                  label: "Era / Period",         category: "parameter", description: "Pick a historical era from 32 entries (1950s, 1990s-mall, ancient-rome, victorian, ...). Emits a period prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "photo-genre",          label: "Photo Genre",          category: "parameter", description: "Pick a photography genre from 46 entries (fashion-editorial, street, macro, documentary, ...). Emits a genre/composition prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "backdrop",             label: "Backdrop",             category: "parameter", description: "Pick a studio backdrop from 40 entries (white-seamless, cyc-wall, gradient, painted, ...). Emits a backdrop prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "render-quality",       label: "Render Quality",       category: "parameter", description: "Pick a render-pipeline preset from 24 entries (raytracing, octane, unreal, blender, ...). Emits a render-quality prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "composition-effects",  label: "Composition Effect",   category: "parameter", description: "Pick a composition effect from 19 entries (bursting-through-frame, depth-of-field, rule-of-thirds, ...). Emits a composition prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "post-process-effects", label: "Post-Process Effect",  category: "parameter", description: "Pick a post-processing effect from 18 entries (vignette-soft, film-grain, light-leak, chromatic-aberration, ...). Emits a post-process prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "action-fx",            label: "Action FX",            category: "parameter", description: "Pick environmental effects (multi-pick) from the action-fx catalog (earthquake, lightning, explosion, falling-objects, ...). Emits a scene-event prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "loop-subject",         label: "Loop Subject",         category: "parameter", description: "Pick a loop subject from 35 entries across 2 categories. Emits a subject descriptor for seamlessly looped video content.", outputType: "text" },

  // ---- Camera family (5) — lens, format, motion, transition, character FX ----
  { type: "camera-motion",        label: "Camera Motion",        category: "parameter", description: "Pick a camera motion from 71 entries across categories (static/pan/tilt/dolly/zoom/track). Graph-aware: walks startState/endState input handles. Emits a 'beginning with X, ending with Y' prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "lens",                 label: "Lens",                 category: "parameter", description: "Pick a lens from 16 entries (wide-angle, normal-50mm, telephoto, fisheye, anamorphic, ...). Emits a lens-characteristic prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "camera-format",        label: "Camera / Film Stock",  category: "parameter", description: "Pick a camera or film format from 31 entries (35mm-film, IMAX, super-8, polaroid, vhs, ...). Emits a camera-medium prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "transition",           label: "Transition",           category: "parameter", description: "Pick a cinematic transition (76 entries, 8 categories) with position/duration/intensity timing fields. Multi-pick supported. Graph-aware startState/endState handles. Emits a transition prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "character-fx",         label: "Character FX",         category: "parameter", description: "Pick character-driven effects (57 entries, 5 categories — transformation, power, body-mod, face FX, aura) with position/duration/intensity timing. Multi-pick supported. Target ref-name substitution via the `target` input handle. Emits a subject-bound prompt fragment via the cinematography handle.", outputType: "text" },

  // ---- Subject / Object family (6) — pose, material, animal, vehicle, weapon, prop ----
  { type: "pose",                 label: "Pose",                 category: "parameter", description: "Pick a pose from 81 entries across categories (standing, sitting, action, dynamic). Emits a pose-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "material",             label: "Material",             category: "parameter", description: "Pick a material from 66 entries (silk, leather, metal, glass, marble, ...). Emits a material-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "animal",               label: "Animal",               category: "parameter", description: "Pick an animal from 126 entries across subcategories (mammal, bird, reptile, sea, insect, etc.). Emits 'featuring a X' prompt fragment with description via the cinematography handle.", outputType: "text" },
  { type: "vehicle",              label: "Vehicle",              category: "parameter", description: "Pick a vehicle from 107 entries across subcategories (car, truck, motorcycle, boat, aircraft, spaceship, etc.). Emits 'featuring a X' prompt fragment with description via the cinematography handle.", outputType: "text" },
  { type: "weapon",               label: "Weapon",               category: "parameter", description: "Pick a weapon from 85 entries across subcategories (blade, ranged, firearm, fantasy, sci-fi, etc.). Emits 'with a X' prompt fragment with description via the cinematography handle.", outputType: "text" },
  { type: "held-prop",            label: "Held Prop",            category: "parameter", description: "Pick a held prop from 59 entries (smartphone, umbrella, bouquet, briefcase, ...). Emits a held-prop prompt fragment via the cinematography handle.", outputType: "text" },

  // ---- Multi-dim family (6) — composed pickers with multiple fields ----
  { type: "framing",              label: "Framing",              category: "parameter", description: "Multi-dim picker for shot-size + angle + coverage + composition + vantage (72 catalog options across 5 fields). Emits a framing-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "lighting",             label: "Lighting",             category: "parameter", description: "Multi-dim picker for time-of-day + lighting-style + lighting-direction (72 catalog options across 3 fields). Emits a lighting-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "person",               label: "Person",               category: "parameter", description: "Multi-dim picker for person attributes — type, age, ethnicity, build, body proportions, face shape, jawline, eyes, nose, lips, hair, eyebrows, skin, facial hair, distinctive features (547 options across 20 fields). Emits a detailed person-description prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "styling",              label: "Styling",              category: "parameter", description: "Multi-dim picker for makeup + eyewear + headwear + hair cut/treatment + jewelry + nails + face-paint + fabric (262 catalog options across 9 fields). Emits a styling-descriptor prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "temporal",             label: "Temporal",             category: "parameter", description: "Multi-dim picker for temporal-speed + freeze + direction + shutter (18 catalog options across 4 fields). Emits a temporal-effect prompt fragment via the cinematography handle.", outputType: "text" },
  { type: "exposure-settings",    label: "Exposure Settings",    category: "parameter", description: "Multi-dim picker for aperture + shutter-speed + ISO (20 catalog options across 3 fields). Emits a camera-exposure prompt fragment via the cinematography handle.", outputType: "text" },
]

/** Enrich descriptors with live credit costs from STATIC_CREDIT_COSTS. */
export function getEnrichedRegistry(): NodeDescriptor[] {
  return NODE_REGISTRY.map((desc) => {
    if (desc.creditCost !== undefined) return desc
    const cost = STATIC_CREDIT_COSTS[desc.type]
    return typeof cost === "number" ? { ...desc, creditCost: cost } : desc
  })
}

export function findNode(type: string): NodeDescriptor | undefined {
  return getEnrichedRegistry().find((n) => n.type === type)
}
