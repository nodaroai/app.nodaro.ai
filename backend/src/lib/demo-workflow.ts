import { isCloud } from "./config.js"

/**
 * The seeded "Welcome Demo" workflow — a finished script → image → video →
 * voice → final-cut run with pre-baked results, inserted once per user into
 * their default project by POST /v1/onboarding/seed-demo.
 *
 * Node/edge shapes mirror what the editor's save path actually persists
 * (verified against production workflow rows, 2026-08-10):
 *   - completed nodes carry `generatedResults` (+ the per-type
 *     `generatedImageUrl`/`generatedVideoUrl`/`generatedAudioUrl` mirror) and
 *     `activeResultIndex`; `executionStatus` is usually absent after save
 *   - result URLs are plain strings — relative `/demo-assets/...` paths are
 *     served same-origin from `frontend/public/` (offline-proof, no storage
 *     backend needed), and the frontend image helper passes them through
 *   - non-UUID `jobId`s ("demo-1") are ignored by the load-time job
 *     reconciler, so the seeded results are never "reconciled" away
 *
 * The demo asset files live in `frontend/public/demo-assets/`. Prompts here
 * are the REAL prompts used to produce those assets. Content is deliberately
 * kept in `backend/` under the SUL — not in the published npm packages.
 */

const TS = "2026-08-10T00:00:00.000Z"

const IMAGE_URL = "/demo-assets/scene-image.jpg"
const CLIP_URL = "/demo-assets/scene-clip.mp4"
const VOICE_URL = "/demo-assets/voiceover.mp3"
const FINAL_URL = "/demo-assets/final-cut.mp4"

export const DEMO_SCENE_PROMPT =
  "A tiny vintage robot barista with warm glowing amber eyes stands on a wooden espresso bar, " +
  "pouring latte art into a ceramic cup. Morning light streams through the cafe window, steam rising, " +
  "soft bokeh, cinematic macro photography, shallow depth of field."

export const DEMO_MOTION_PROMPT =
  "Slow cinematic push-in. The little robot finishes the pour with a gentle nod, " +
  "steam curling up from the cup, dust motes drifting through the warm light."

export const DEMO_NARRATION_TEXT =
  "It started as one sentence. Image, motion, voice - one canvas. Now try yours."

const WELCOME_NOTE_TEXT = [
  "Welcome to Nodaro",
  "",
  "This canvas is a finished run. One sentence (Scene Idea) became an image, the image became motion, and a voice line tied it together in the Final Cut.",
  "",
  "Click any node to see its settings and result. Nothing here costs anything to look at.",
  "",
  "To make it yours: edit the Scene Idea text, then press Run on the Scene Image node.",
].join("\n")

const RUN_NOTE_TEXT_CLOUD = [
  "Run your first generation",
  "",
  "The Scene Image node uses Z-Image - the fastest, cheapest model in the catalog: about 2 credits and under 10 seconds.",
  "",
  "Your account starts with free credits. Edit the Scene Idea, hit Run on Scene Image, then keep going down the chain.",
].join("\n")

// The first thing a self-hoster reads after signing up. Both levers it names
// exist today: Connect nodaro.ai (OAuth, no key, #668) and pasting a key on
// Install health (stored encrypted, live without a restart, #671). It used to
// send people to edit .env and restart the container (#706).
const RUN_NOTE_TEXT_SELF_HOST = [
  "Run your first generation",
  "",
  "Generating needs a model provider. Easiest: open /setup and click Connect nodaro.ai (one click, no key, free credits to start). Or paste your own KIE.ai / Replicate key there — it takes effect immediately, no restart. Your own keys always win.",
  "",
  "/setup also shows what this install has: database, Redis, storage, and every provider at a glance.",
].join("\n")

export interface DemoWorkflowContent {
  readonly name: string
  readonly description: string
  readonly nodes: ReadonlyArray<Record<string, unknown>>
  readonly edges: ReadonlyArray<Record<string, unknown>>
  readonly settings: Record<string, unknown>
  readonly thumbnailUrl: string
}

export function buildDemoWorkflow(): DemoWorkflowContent {
  const runNoteText = isCloud() ? RUN_NOTE_TEXT_CLOUD : RUN_NOTE_TEXT_SELF_HOST

  const nodes: Array<Record<string, unknown>> = [
    {
      id: "demo-note-welcome",
      type: "sticky-note",
      position: { x: -80, y: -430 },
      data: {
        label: "Sticky Note",
        text: WELCOME_NOTE_TEXT,
        color: "#2d2d44",
        textColor: "#ffffff",
        width: 460,
        height: 330,
        fontSize: "base",
        bold: false,
        italic: false,
        alignment: "left",
      },
    },
    {
      id: "demo-idea",
      type: "text-prompt",
      position: { x: 0, y: 60 },
      data: {
        label: "Scene Idea",
        text: DEMO_SCENE_PROMPT,
        variables: {},
        width: 380,
        height: 260,
      },
    },
    {
      id: "demo-image",
      type: "generate-image",
      position: { x: 500, y: 0 },
      data: {
        label: "Scene Image",
        // Deliberately empty: the wired Scene Idea text IS the prompt
        // (typed-empty → wired fallback in the shared prompt precedence),
        // so editing the text node and pressing Run behaves as the sticky
        // note promises.
        prompt: "",
        provider: "z-image",
        model: "z-image",
        style: "",
        aspectRatio: "16:9",
        negativePrompt: "",
        fieldMappings: {},
        generatedResults: [
          { url: IMAGE_URL, jobId: "demo-1", timestamp: TS, width: 1280, height: 720 },
        ],
        activeResultIndex: 0,
        generatedImageUrl: IMAGE_URL,
      },
    },
    {
      id: "demo-video",
      type: "generate-video",
      position: { x: 1260, y: 0 },
      data: {
        label: "Animate",
        prompt: DEMO_MOTION_PROMPT,
        provider: "seedance-2-fast",
        duration: 5,
        aspectRatio: "16:9",
        imageUrl: IMAGE_URL,
        fieldMappings: {},
        generatedResults: [
          { url: CLIP_URL, jobId: "demo-2", timestamp: TS, width: 1280, height: 720, duration: 5 },
        ],
        activeResultIndex: 0,
        generatedVideoUrl: CLIP_URL,
      },
    },
    {
      id: "demo-narration",
      type: "text-prompt",
      position: { x: 720, y: 640 },
      data: {
        label: "Narration",
        text: DEMO_NARRATION_TEXT,
        variables: {},
        width: 380,
        height: 200,
      },
    },
    {
      id: "demo-voice",
      type: "text-to-speech",
      position: { x: 1260, y: 640 },
      data: {
        label: "Voiceover",
        provider: "elevenlabs-turbo",
        // Premade voice NAME, not an ElevenLabs UUID — matches both the call
        // that produced the baked asset and how production rows persist it.
        voiceId: "Rachel",
        voiceType: "premade",
        voiceDisplayName: "Rachel",
        language: "en",
        speed: 1,
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        languageCode: "",
        textSource: "connected",
        directText: "",
        fieldMappings: {},
        generatedResults: [
          { url: VOICE_URL, jobId: "demo-3", timestamp: TS, duration: 7.7 },
        ],
        activeResultIndex: 0,
        generatedAudioUrl: VOICE_URL,
      },
    },
    {
      id: "demo-final",
      type: "merge-video-audio",
      position: { x: 2040, y: 320 },
      data: {
        label: "Final Cut",
        audioType: "voiceover",
        voiceoverVolume: 100,
        backgroundVolume: 30,
        fieldMappings: {},
        generatedResults: [
          { url: FINAL_URL, jobId: "demo-4", timestamp: TS, width: 1280, height: 720, duration: 7.7 },
        ],
        activeResultIndex: 0,
        generatedVideoUrl: FINAL_URL,
      },
    },
    {
      id: "demo-note-run",
      type: "sticky-note",
      position: { x: 2800, y: -160 },
      data: {
        label: "Sticky Note",
        text: runNoteText,
        color: "#2d2d44",
        textColor: "#ffffff",
        width: 420,
        height: 300,
        fontSize: "base",
        bold: false,
        italic: false,
        alignment: "left",
      },
    },
  ]

  const edges: Array<Record<string, unknown>> = [
    {
      id: "demo-e1",
      source: "demo-idea",
      target: "demo-image",
      sourceHandle: "prompt",
      targetHandle: "prompt",
    },
    {
      id: "demo-e2",
      source: "demo-image",
      target: "demo-video",
      sourceHandle: "image",
      targetHandle: "startFrame",
    },
    {
      id: "demo-e3",
      source: "demo-narration",
      target: "demo-voice",
      sourceHandle: "prompt",
      targetHandle: "prompt",
    },
    {
      id: "demo-e4",
      source: "demo-video",
      target: "demo-final",
      sourceHandle: "video",
      targetHandle: "in",
    },
    {
      id: "demo-e5",
      source: "demo-voice",
      target: "demo-final",
      sourceHandle: "audio",
      targetHandle: "in",
    },
  ]

  return {
    name: "Welcome Demo: First Scene",
    description:
      "A finished run: one sentence became an image, motion, and voice. Edit the Scene Idea and run it yourself.",
    nodes,
    edges,
    settings: { demoSeed: true },
    thumbnailUrl: IMAGE_URL,
  }
}
