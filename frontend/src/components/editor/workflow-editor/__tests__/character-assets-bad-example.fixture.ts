/**
 * The owner's "bad example" export (2026-08-25), transcribed VERBATIM minus
 * generated results: two full Character nodes wired `characterRef → assets`
 * into one generate-image, one edge carrying stray list-edge data. Only one
 * character reached the provider on the live run. Rich node data is the
 * point — a minimized fixture passed every layer this graph fails.
 */

const AVIRAM_ANGLES = [
  { url: "https://cdn.test/aviram/back1.png", name: "back", description: "Back of head and shoulders, military-buzzed dark brown hair visible, broad neck and athletic build framing the shot, face turned away entirely." },
  { url: "https://cdn.test/aviram/left-profile.png", name: "left profile", description: "Left profile view, camera level with his ear, capturing strong jaw line." },
  { url: "https://cdn.test/aviram/34r1.png", name: "3/4 right", description: "Three-quarter view angled right, strong jaw and thick neck prominent." },
  { url: "https://cdn.test/aviram/34l1.png", name: "3/4 left", description: "Three-quarter view angled left, strong jaw and thick neck prominent." },
  { url: "https://cdn.test/aviram/below.png", name: "below", description: "Low-angle shot looking up at his strong jaw and thick neck." },
  { url: "https://cdn.test/aviram/right-profile.png", name: "right profile", description: "Right profile view, subject facing hard left." },
  { url: "https://cdn.test/aviram/above.png", name: "above", description: "Camera angle looking down from above." },
  // Duplicate variant names on purpose — the export carries them.
  { url: "https://cdn.test/aviram/34l2.png", name: "3/4 left", description: "Three-quarter view angled left, relaxed lips faintly parted." },
  { url: "https://cdn.test/aviram/34r2.png", name: "3/4 right", description: "Three-quarter view angled right, natural ambient lighting." },
  { url: "https://cdn.test/aviram/back2.png", name: "back", description: "Full back view of the man, head slightly turned." },
]

const AVIRAM_BODY_ANGLES = [
  // First entry has NO description — verbatim from the export.
  { url: "https://cdn.test/aviram/body-front1.png", name: "front" },
  { url: "https://cdn.test/aviram/body-front2.png", name: "front", description: "Full-body front-facing shot, subject standing upright." },
  { url: "https://cdn.test/aviram/body-front3.png", name: "front", description: "Full-body front-facing view, even studio lighting." },
  { url: "https://cdn.test/aviram/body-front4.png", name: "front", description: "Full-body front-facing view, straight-on camera angle." },
]

export const AVIRAM_URL = "https://cdn.test/aviram/source.png"
export const JESSICA_URL = "https://cdn.test/jessica/source.png"

export const aviramNode = {
  id: "node_4",
  type: "character",
  position: { x: 608, y: 2400 },
  data: {
    label: "Aviram 1",
    poses: [],
    style: "realistic",
    voice: { traits: "", voiceId: "v1", voiceName: "Ilydrw", voiceType: "library", previewUrl: "https://cdn.test/voice-a.mp3", ttsProvider: "elevenlabs-turbo" },
    angles: AVIRAM_ANGLES,
    boards: [],
    gender: "male",
    sheets: [],
    motions: [],
    bodyAngles: AVIRAM_BODY_ANGLES,
    description: "A man in his late twenties to mid-thirties with steel-blue eyes.",
    expressions: [],
    personality: null,
    identityLock: "strict",
    motionStatus: "idle",
    characterDbId: "",
    characterName: "Aviram 1",
    detailCloseups: [],
    sourceImageUrl: AVIRAM_URL,
    loraTriggerWord: null,
    outfitVariations: [],
    lightingVariations: [],
    loraTrainingStatus: null,
    canonicalDescription: "A man in his late twenties to mid-thirties with steel-blue eyes set beneath heavy dark brows.",
    loraReplicateVersion: null,
    selectedAssetByVariant: {
      studioKept: '["https://cdn.test/aviram/kept1.png","https://cdn.test/aviram/kept2.png"]',
      "angles:back": "https://cdn.test/aviram/back2.png",
      "angles:3/4 left": "https://cdn.test/aviram/34l2.png",
      "angles:3/4 right": "https://cdn.test/aviram/34r2.png",
      "bodyAngles:front": "https://cdn.test/aviram/body-front-picked.png",
      "studioDismissed:28d6e936-638b-4713-8c6c-8cec64906049": "1",
    },
    referenceVideosByVariant: {},
  },
}

export const jessicaNode = {
  id: "node_5",
  type: "character",
  position: { x: 656, y: 1616 },
  data: {
    label: "Jessica",
    poses: [],
    style: "realistic",
    voice: { traits: "", voiceId: "v2", voiceName: "Sara", voiceType: "library", previewUrl: "https://cdn.test/voice-j.mp3", ttsProvider: "elevenlabs-turbo" },
    angles: [
      { url: "https://cdn.test/jessica/right-profile.png", name: "right profile", description: "Perfect right-profile view." },
      { url: "https://cdn.test/jessica/left-profile.png", name: "left profile", description: "Perfect left profile view." },
      { url: "https://cdn.test/jessica/back.png", name: "back", description: "Full back view of the woman." },
      { url: "https://cdn.test/jessica/34l.png", name: "3/4 left", description: "Soft three-quarter view angled left." },
      { url: "https://cdn.test/jessica/34r.png", name: "3/4 right", description: "Viewed from a three-quarter angle turned slightly right." },
      { url: "https://cdn.test/jessica/above.png", name: "above", description: "Shot from directly above." },
      { url: "https://cdn.test/jessica/below.png", name: "below", description: "Shot from below looking up." },
    ],
    boards: [
      {
        url: "https://cdn.test/jessica/identity-sheet.png",
        name: "Jessica Kaplan-Identity sheet",
        type: "identity",
        sourceImages: [JESSICA_URL, "https://cdn.test/jessica/right-profile.png"],
      },
    ],
    gender: "other",
    sheets: [],
    motions: [],
    createdAt: "",
    poseSheet: "",
    projectId: "",
    baseOutfit: "",
    bodyAngles: [
      { url: "https://cdn.test/jessica/body-front.png", name: "front", description: "Full-body front-facing view." },
    ],
    poseStatus: "idle",
    anglesSheet: "",
    description: "",
    expressions: [],
    personality: null,
    anglesStatus: "idle",
    identityLock: "strict",
    motionStatus: "idle",
    characterDbId: "",
    characterName: "Jessica Kaplan",
    fieldMappings: {},
    lightingSheet: "",
    characterSheet: null,
    detailCloseups: [],
    lightingStatus: "idle",
    sourceImageUrl: JESSICA_URL,
    expressionSheet: "",
    bodyAnglesStatus: "idle",
    customVariations: [],
    expressionStatus: "idle",
    generatedResults: [],
    outfitVariations: [],
    activeResultIndex: 0,
    lightingVariations: [],
    canonicalDescription: "A woman in her late twenties to early thirties with striking blue-grey eyes.",
    selectedAssetByVariant: {
      studioKept: `["${JESSICA_URL}"]`,
    },
    referenceVideosByVariant: {},
  },
}

export const generateImageNode = {
  id: "node_3",
  type: "generate-image",
  position: { x: 1392, y: 1680 },
  data: {
    label: "Lagoon Walk",
    model: "gemini-2.5-flash-image",
    style: "",
    prompt: "{image:2} and {image:1} walking hand in hand along the shore of a turquoise lagoon.",
    provider: "nano-banana-pro",
    aspectRatio: "16:9",
    fieldMappings: {},
    negativePrompt: "",
  },
}

/** Edges verbatim: Jessica's carries stray list-edge data. */
export const badExampleEdges = [
  {
    id: "edge_1787680539356",
    data: { itemIndex: "1", outputMode: "item" },
    type: "default",
    source: "node_5",
    target: "node_3",
    sourceHandle: "characterRef",
    targetHandle: "assets",
  },
  {
    id: "edge_1787680645395",
    type: "default",
    source: "node_4",
    target: "node_3",
    sourceHandle: "characterRef",
    targetHandle: "assets",
  },
]

export const badExampleNodes = [generateImageNode, aviramNode, jessicaNode]
