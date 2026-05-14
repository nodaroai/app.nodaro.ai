/**
 * Spec §5.4 audit (Task F2): verify `get_workflow_json` response doesn't
 * exceed MCP client context budgets for a typical 50-node Film Director
 * workflow.
 *
 * This is a SIZING test, not a behavior test. It constructs a realistic
 * workflow graph in memory — node shapes match those in
 * `frontend/src/types/nodes.ts` (SceneNodeDataType, CharacterNodeData,
 * LocationNodeData, ImageToVideoData, LipSyncData, GenerateMusicData,
 * TextToAudioData, CombineVideosData, etc.) — and measures the serialized
 * JSON size in bytes, plus a rough char/4 token estimate.
 *
 * Why this matters: the Nodaro Film Director skill's Stage 0 calls the MCP
 * `get_workflow_json` tool to fetch the reference template so Claude can
 * see the canonical JSON shape for manually-constructed node types. The
 * full response is dropped into the conversation context as a tool result.
 * If that response is too large, Claude's context budget is eaten before
 * the conversation even starts.
 *
 * Context budgets at time of writing (2026-05-14):
 *   Claude (Anthropic):   200K tokens
 *   ChatGPT (OpenAI):     ~128K tokens (varies by model)
 *   Gemini (Google):      1M tokens
 *   Cursor:               varies (typically 100-200K)
 *
 * Target: keep a typical 50-node Film Director workflow under 12.5% of
 * Claude's 200K context (i.e. ≤ 25K estimated tokens / ≤ 100KB serialized)
 * to leave room for conversation history and downstream tool calls.
 */
import { describe, expect, test } from "vitest"

// ── Helpers ─────────────────────────────────────────────────────────

type WorkflowNode = {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  width?: number
  height?: number
}

type WorkflowEdge = {
  id: string
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
}

const R2_BASE = "https://media.nodaro.ai/r2"

const exampleResult = (kind: "image" | "video" | "audio", idx: number) => {
  const base: Record<string, unknown> = {
    url: `${R2_BASE}/users/abc123/${kind}s/${kind}_${idx}_${Date.now()}.${
      kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"
    }`,
    timestamp: "2026-05-14T12:34:56.789Z",
    jobId: `job_${kind}_${idx}_a1b2c3d4`,
  }
  if (kind === "image") {
    base.width = 1920
    base.height = 1080
    base.thumbnailUrl = `${R2_BASE}/users/abc123/thumbs/${kind}_${idx}_thumb.jpg`
  } else if (kind === "video") {
    base.width = 1920
    base.height = 1080
    base.duration = 8
    base.thumbnailUrl = `${R2_BASE}/users/abc123/thumbs/${kind}_${idx}_thumb.jpg`
  } else {
    base.duration = 12.4
  }
  return base
}

// ── Stage 1: Script display ─────────────────────────────────────────

const scriptNode: WorkflowNode = {
  id: "n_script",
  type: "text-prompt",
  position: { x: 0, y: 0 },
  data: {
    label: "Script",
    text:
      "FADE IN:\n\n" +
      "EXT. SEASIDE CLIFF — GOLDEN HOUR\n\n" +
      "A lone figure, MIRA (30s, weathered, eyes the color of storm-glass), " +
      "stands at the edge, wind catching her coat. She looks out over the " +
      "water, unmoving. Behind her, a faint silhouette emerges from the path: " +
      "KAI, her younger brother, hands jammed in his pockets.\n\n" +
      "KAI\n  (softly)\n" +
      "You came back.\n\n" +
      "MIRA\n  (not turning)\n" +
      "I never left.\n\n" +
      "He steps closer. The wind picks up.\n\n" +
      "KAI\n" +
      "Mom's asking about you.\n\n" +
      "MIRA\n  (a long pause)\n" +
      "Tell her I'm fine.\n\n" +
      "Kai watches her for a moment, then nods slowly. He retreats up the " +
      "path. Mira stays at the edge, alone again. The sun dips lower.\n\n" +
      "CUT TO:\n\n" +
      "INT. CLIFFSIDE COTTAGE — KITCHEN — DUSK\n\n" +
      "An older woman, ELENA (60s, soft features sharpened by years of " +
      "worry), stirs a pot at the stove. The window behind her frames the " +
      "darkening sea. Kai enters, shaking sea-spray from his hair.\n\n" +
      "ELENA\n  (without turning)\n" +
      "Did you find her?\n\n" +
      "KAI\n" +
      "She's at the cliff. Same as always.\n\n" +
      "Elena sets the spoon down. Her shoulders drop.\n\n" +
      "ELENA\n" +
      "Some days I think the sea will keep her.\n\n" +
      "Kai puts a hand on her shoulder. They stand together in silence.\n\n" +
      "FADE OUT.",
    variables: {},
    color: "#1a1a2e",
    bold: false,
    italic: false,
    alignment: "left",
    outputTarget: "text",
    width: 480,
    height: 320,
  },
  width: 480,
  height: 320,
}

// ── Stage 2: Shot list ──────────────────────────────────────────────

const shotListNode: WorkflowNode = {
  id: "n_shotlist",
  type: "list",
  position: { x: 560, y: 0 },
  data: {
    label: "Shot List",
    columns: [
      { id: "col_shot", name: "Shot", handleId: "col_shot", type: "text" },
      { id: "col_desc", name: "Description", handleId: "col_desc", type: "text" },
      { id: "col_dur", name: "Duration (s)", handleId: "col_dur", type: "text" },
      { id: "col_cam", name: "Camera", handleId: "col_cam", type: "text" },
      { id: "col_loc", name: "Location", handleId: "col_loc", type: "text" },
      { id: "col_notes", name: "Notes", handleId: "col_notes", type: "text" },
    ],
    rows: [
      ["1", "Wide establishing — cliff at golden hour", "5", "Wide, static", "Cliff", "Anchor frame"],
      ["2", "Medium — Mira's back, wind in coat", "4", "Medium, slight push-in", "Cliff", "Match geo from #1"],
      ["3", "Close — Mira's face in profile, eyes on horizon", "3", "Close-up, static", "Cliff", "Same key light"],
      ["4", "Wide — Kai emerges on path behind her", "5", "Wide, low angle", "Cliff", "Reveal #2 character"],
      ["5", "Two-shot — Mira and Kai, his approach", "6", "Medium, dolly", "Cliff", "Dialog beats 1-2"],
      ["6", "Close — Kai's face, soft worry", "3", "Close-up", "Cliff", "Dialog beat 3"],
      ["7", "Wide — Kai retreats up path, Mira alone", "5", "Wide, static", "Cliff", "Reset frame"],
      ["8", "Cottage interior — Elena at stove", "6", "Medium, push-in slowly", "Cottage", "Cut after sun dips"],
    ],
    fieldMappings: {},
    viewMode: "list",
    thumbnailSize: "md",
    galleryCols: 3,
    showData: true,
    textMaxLines: 3,
    textFontSize: "medium",
  },
  width: 880,
  height: 420,
}

// ── Stage 3: Characters (3 characters, each with main + variants) ────

const makeCharacterNode = (
  idx: number,
  name: string,
  description: string,
  gender: "male" | "female" | "other",
): WorkflowNode => ({
  id: `n_char_${idx}`,
  type: "character",
  position: { x: idx * 520, y: 540 },
  data: {
    label: `Character: ${name}`,
    characterDbId: `char_${idx}_db_${"a".repeat(20)}`,
    characterName: name,
    description,
    sourceImageUrl: `${R2_BASE}/users/abc123/characters/char_${idx}_source.png`,
    gender,
    style: "realistic",
    baseOutfit:
      "long charcoal-grey wool coat over a faded denim button-down, dark jeans, " +
      "weather-worn leather boots; silver pendant at the throat",
    provider: "nano-banana-pro",
    identityLock: "soft",
    characterSheet: null,
    projectId: "proj_film_abc123",
    createdAt: "2026-05-14T12:00:00.000Z",
    executionStatus: "completed",
    generatedResults: [exampleResult("image", idx * 10)],
    activeResultIndex: 0,
    fieldMappings: {},
    expressionSheet: `${R2_BASE}/users/abc123/characters/char_${idx}_expression_sheet.png`,
    poseSheet: `${R2_BASE}/users/abc123/characters/char_${idx}_pose_sheet.png`,
    lightingSheet: `${R2_BASE}/users/abc123/characters/char_${idx}_lighting_sheet.png`,
    anglesSheet: `${R2_BASE}/users/abc123/characters/char_${idx}_angles_sheet.png`,
    expressions: ["neutral", "smiling", "worried", "angry", "sad", "surprised"].map((emo, i) => ({
      name: emo,
      url: `${R2_BASE}/users/abc123/characters/char_${idx}_expr_${i}.png`,
    })),
    poses: [],
    lightingVariations: [],
    angles: ["front", "3q_left", "left", "right", "3q_right", "back"].map((angle, i) => ({
      name: angle,
      url: `${R2_BASE}/users/abc123/characters/char_${idx}_angle_${i}.png`,
    })),
    expressionStatus: "completed",
    poseStatus: "idle",
    lightingStatus: "idle",
    anglesStatus: "completed",
    customVariations: [],
    motions: [],
    motionStatus: "idle",
    voice: {
      voiceId: `el_voice_char_${idx}`,
      provider: "elevenlabs",
      label: `${name} voice`,
      designedPrompt:
        "Mid-30s feminine voice, slightly weary but resonant. Soft contralto register. " +
        "Pace: unhurried. Energy: contemplative.",
    },
    personality: {
      traits: ["stoic", "guarded", "loyal"],
      mannerisms: "Speaks in short clauses. Long pauses before answering.",
      background:
        "Lost her father at 19, raised her younger brother after their mother " +
        "withdrew. Returned home after a decade in the city.",
    },
  },
  width: 360,
  height: 480,
})

const charNodes: WorkflowNode[] = [
  makeCharacterNode(
    1,
    "Mira",
    "30s, weathered, eyes the color of storm-glass. Quiet posture, contained " +
      "energy. Wears a charcoal coat against the wind. The kind of person who " +
      "looks like she's listening to something only she can hear.",
    "female",
  ),
  makeCharacterNode(
    2,
    "Kai",
    "Mid-20s, lean, dark hair perpetually wind-tousled. Hands always in his " +
      "pockets. Softer than his sister Mira, less guarded. Watches her with the " +
      "patience of someone who has done so for years.",
    "male",
  ),
  makeCharacterNode(
    3,
    "Elena",
    "Early 60s, silver hair pulled back. Soft features sharpened by years of " +
      "worry. The careful hands of someone who has cooked the same meals for " +
      "three decades. Eyes that have learned to wait.",
    "female",
  ),
]

// Per-character expression variant nodes (image-to-image, generated from main).
const makeCharVariantNode = (
  charIdx: number,
  variantIdx: number,
  variantKind: "angle" | "emotion",
  variantLabel: string,
): WorkflowNode => ({
  id: `n_char_${charIdx}_${variantKind}_${variantIdx}`,
  type: "image-to-image",
  position: { x: charIdx * 520, y: 1100 + variantIdx * 240 },
  data: {
    label: `${variantKind === "angle" ? "Angle" : "Emotion"}: ${variantLabel}`,
    prompt:
      variantKind === "angle"
        ? `Same character, ${variantLabel} angle, identical lighting and outfit, ` +
          "same identity, neutral expression"
        : `Same character, ${variantLabel} expression, identical framing and lighting, ` +
          "same identity, eye contact",
    provider: "nano-banana-pro",
    style: "realistic",
    aspectRatio: "1:1",
    resolution: "2K",
    quality: "high",
    negativePrompt: "blurry, distorted, low quality, malformed face, extra limbs",
    seed: 42_000 + charIdx * 100 + variantIdx,
    renderingSpeed: "standard",
    guidanceScale: 7.5,
    referenceImageUrl: `${R2_BASE}/users/abc123/characters/char_${charIdx}_source.png`,
    characterDefinitionIds: [`char_${charIdx}_db_${"a".repeat(20)}`],
    connectedMediaOrder: [`n_char_${charIdx}`],
    fieldMappings: {},
    executionStatus: "completed",
    generatedImageUrl: `${R2_BASE}/users/abc123/images/char_${charIdx}_${variantKind}_${variantIdx}.png`,
    generatedResults: [
      exampleResult("image", charIdx * 100 + variantIdx),
    ],
    activeResultIndex: 0,
    currentJobId: `job_char_var_${charIdx}_${variantIdx}`,
  },
  width: 320,
  height: 360,
})

const charVariantNodes: WorkflowNode[] = []
const angleLabels = ["3q-left", "left-profile", "right-profile"] as const
const emotionLabels = ["worried", "determined", "softened"] as const
for (let c = 1; c <= 3; c++) {
  for (let i = 0; i < 3; i++) {
    charVariantNodes.push(makeCharVariantNode(c, i, "angle", angleLabels[i]))
    charVariantNodes.push(makeCharVariantNode(c, i, "emotion", emotionLabels[i]))
  }
}

// Per-character voice design nodes.
const makeVoiceDesignNode = (charIdx: number, characterName: string): WorkflowNode => ({
  id: `n_voice_${charIdx}`,
  type: "voice-design",
  position: { x: charIdx * 520, y: 1860 },
  data: {
    label: `Voice: ${characterName}`,
    prompt:
      charIdx === 1
        ? "Mid-30s feminine, soft contralto, weary but resonant. Slow cadence, " +
          "introspective. American — Pacific Northwest. Slight rasp on long vowels."
        : charIdx === 2
          ? "Mid-20s masculine, warm tenor. Conversational, soft-edged. Pacific " +
            "Northwest cadence. Slightly quicker than his sister's voice."
          : "Early-60s feminine, slightly worn alto. Maternal warmth tempered with " +
            "decades of restraint. Pacific Northwest cadence. Speaks slightly below " +
            "audible breath.",
    model: "eleven_v3",
    voiceName: `${characterName} (designed)`,
    loudness: 0.5,
    guidance: 0.7,
    seed: 1234 + charIdx,
    quality: "high",
    enhance: true,
    fieldMappings: {},
    executionStatus: "completed",
    generatedAudioUrl: `${R2_BASE}/users/abc123/voices/voice_${charIdx}_design.mp3`,
    generatedResults: [exampleResult("audio", 700 + charIdx)],
    activeResultIndex: 0,
    voiceId: `el_voice_designed_${charIdx}`,
  },
  width: 320,
  height: 280,
})

const voiceDesignNodes: WorkflowNode[] = [
  makeVoiceDesignNode(1, "Mira"),
  makeVoiceDesignNode(2, "Kai"),
  makeVoiceDesignNode(3, "Elena"),
]

// ── Stage 4: Locations (2 locations, each with main + variants) ──────

const makeLocationNode = (
  idx: number,
  name: string,
  description: string,
  category: "outdoor" | "indoor",
): WorkflowNode => ({
  id: `n_loc_${idx}`,
  type: "location",
  position: { x: 1700 + idx * 520, y: 540 },
  data: {
    label: `Location: ${name}`,
    locationDbId: `loc_${idx}_db_${"b".repeat(20)}`,
    locationName: name,
    description,
    category,
    style: "realistic",
    provider: "flux",
    sourceImageUrl: `${R2_BASE}/users/abc123/locations/loc_${idx}_source.png`,
    projectId: "proj_film_abc123",
    createdAt: "2026-05-14T12:00:00.000Z",
    executionStatus: "completed",
    generatedResults: [exampleResult("image", 500 + idx)],
    activeResultIndex: 0,
    fieldMappings: {},
    timeOfDay: ["dawn", "noon", "sunset", "night"].map((tod, i) => ({
      name: tod,
      url: `${R2_BASE}/users/abc123/locations/loc_${idx}_tod_${i}.png`,
    })),
    weather: [],
    angles: ["wide", "medium", "close"].map((ang, i) => ({
      name: ang,
      url: `${R2_BASE}/users/abc123/locations/loc_${idx}_angle_${i}.png`,
    })),
    timeOfDayStatus: "completed",
    weatherStatus: "idle",
    anglesStatus: "completed",
    customVariations: [],
  },
  width: 360,
  height: 440,
})

const locNodes: WorkflowNode[] = [
  makeLocationNode(
    1,
    "Seaside Cliff",
    "A wind-scoured cliff edge on the Oregon coast. Salt grass and basalt. " +
      "The sea below is iron-grey under most light, copper-touched at sunset. " +
      "A narrow gravel path winds up from the cottage below. Solitary, " +
      "exposed, beautiful.",
    "outdoor",
  ),
  makeLocationNode(
    2,
    "Cliffside Cottage",
    "Small two-room wooden cottage. Weathered shingles. A single kitchen " +
      "window faces the sea. Cast-iron stove, scarred pine table, hand-knit " +
      "blanket folded over a bentwood chair. Warm in tone — amber lamplight, " +
      "wood grain, copper kettle. Lived-in.",
    "indoor",
  ),
]

// Per-location variant nodes (alternate time-of-day / angles).
const makeLocVariantNode = (
  locIdx: number,
  variantIdx: number,
  variantLabel: string,
): WorkflowNode => ({
  id: `n_loc_${locIdx}_var_${variantIdx}`,
  type: "image-to-image",
  position: { x: 1700 + locIdx * 520, y: 1100 + variantIdx * 240 },
  data: {
    label: `${variantLabel}`,
    prompt:
      `Same location, ${variantLabel}, identical framing and architecture, ` +
      "same identity for landscape features. Realistic, cinematic lighting.",
    provider: "flux",
    style: "realistic",
    aspectRatio: "16:9",
    resolution: "2K",
    quality: "high",
    negativePrompt: "blurry, low quality, distorted geometry, surreal",
    seed: 84_000 + locIdx * 100 + variantIdx,
    renderingSpeed: "standard",
    guidanceScale: 7.5,
    referenceImageUrl: `${R2_BASE}/users/abc123/locations/loc_${locIdx}_source.png`,
    characterDefinitionIds: [`loc_${locIdx}_db_${"b".repeat(20)}`],
    connectedMediaOrder: [`n_loc_${locIdx}`],
    fieldMappings: {},
    executionStatus: "completed",
    generatedImageUrl: `${R2_BASE}/users/abc123/images/loc_${locIdx}_var_${variantIdx}.png`,
    generatedResults: [exampleResult("image", 600 + locIdx * 10 + variantIdx)],
    activeResultIndex: 0,
    currentJobId: `job_loc_var_${locIdx}_${variantIdx}`,
  },
  width: 320,
  height: 360,
})

const locVariantNodes: WorkflowNode[] = []
const locVariantLabels = ["Sunset variant", "Night variant"] as const
for (let l = 1; l <= 2; l++) {
  for (let i = 0; i < 2; i++) {
    locVariantNodes.push(makeLocVariantNode(l, i, locVariantLabels[i]))
  }
}

// ── Stage 5: 8 Scene image nodes (one per shot) ─────────────────────

const makeSceneImageNode = (sceneIdx: number, shotDescription: string, isInterior: boolean): WorkflowNode => ({
  id: `n_scene_${sceneIdx}`,
  type: "scene",
  position: { x: sceneIdx * 540, y: 2400 },
  data: {
    label: `Scene ${sceneIdx}`,
    sceneName: shotDescription.slice(0, 40),
    sceneNumber: sceneIdx,
    duration: sceneIdx === 5 ? 6 : sceneIdx === 8 ? 6 : 5,
    summary:
      `Shot ${sceneIdx} of the seaside drama. ${shotDescription}. ` +
      `${isInterior ? "Interior cottage" : "Exterior cliff"}. Cinematic framing, ` +
      "deliberate stillness, golden-hour palette transitioning to dusk.",
    characters: isInterior
      ? [
          { assetId: `n_char_2`, mood: "concerned", action: "entering kitchen", positionInFrame: "left" },
          { assetId: `n_char_3`, mood: "weary", action: "stirring pot at stove", positionInFrame: "center" },
        ]
      : [
          { assetId: `n_char_1`, mood: "contemplative", action: "standing at edge", positionInFrame: "right" },
        ],
    dialogue:
      sceneIdx === 5
        ? [
            { characterId: "n_char_2", characterName: "Kai", text: "You came back.", emotion: "soft" },
            { characterId: "n_char_1", characterName: "Mira", text: "I never left.", emotion: "distant" },
          ]
        : sceneIdx === 8
          ? [
              { characterId: "n_char_3", characterName: "Elena", text: "Did you find her?", emotion: "tired" },
              { characterId: "n_char_2", characterName: "Kai", text: "She's at the cliff. Same as always.", emotion: "resigned" },
            ]
          : [],
    locations: [
      {
        assetId: isInterior ? "n_loc_2" : "n_loc_1",
        name: isInterior ? "Cliffside Cottage" : "Seaside Cliff",
        isPrimary: true,
        timeOfDay: isInterior ? "evening" : "sunset",
        weather: "clear",
        lighting: isInterior ? "soft" : "natural",
      },
    ],
    timeOfDay: isInterior ? "evening" : "sunset",
    weather: "clear",
    lighting: isInterior ? "soft" : "natural",
    objects: [],
    aspectRatio: "16:9",
    shotType: sceneIdx === 1 || sceneIdx === 4 || sceneIdx === 7 ? "wide" : sceneIdx === 3 || sceneIdx === 6 ? "close-up" : "medium",
    cameraAngle: sceneIdx === 4 ? "low-angle" : "eye-level",
    cameraMovement: sceneIdx === 2 ? "dolly" : sceneIdx === 5 ? "dolly" : "static",
    depthOfField: "medium",
    lensType: sceneIdx === 1 ? "wide" : sceneIdx === 3 ? "telephoto" : "normal",
    mood: isInterior ? ["intimate", "weary"] : ["contemplative", "solitary"],
    colorPalette: isInterior ? ["amber", "umber", "warm-grey"] : ["amber", "teal", "iron-grey"],
    visualStyle: "cinematic",
    narration: isInterior
      ? "Inside, Elena stirs a pot. The window frames the darkening sea."
      : "Mira stands at the edge, wind catching her coat. The water below moves slowly.",
    musicMood: "ambient-strings",
    soundEffects: isInterior ? ["pot bubbling", "wind muffled"] : ["wind", "distant gulls", "ocean swell"],
    transitionIn: sceneIdx === 1 ? "fade" : "cut",
    transitionOut: sceneIdx === 8 ? "fade" : "cut",
    directorNotes:
      "Hold the silence — let the wind and breath do the work. " +
      `Match continuity from shot ${sceneIdx - 1} where applicable.`,
    referenceUrls: [
      `${R2_BASE}/users/abc123/locations/loc_${isInterior ? 2 : 1}_source.png`,
    ],
    generatedPrompt:
      `Cinematic ${isInterior ? "interior" : "exterior"} shot. ${shotDescription}. ` +
      `Golden hour transitioning to ${isInterior ? "dusk" : "evening"} light. ` +
      "35mm anamorphic feel, soft contrast, slight film grain. " +
      "Color palette: amber, teal, iron-grey. Mood: contemplative. " +
      "Frame for stillness — slight negative space toward the horizon.",
    executionStatus: "completed",
    generatedResults: [exampleResult("image", 1000 + sceneIdx)],
    activeResultIndex: 0,
    generatedImageUrl: `${R2_BASE}/users/abc123/scenes/scene_${sceneIdx}.png`,
    fieldMappings: {},
    sourceScriptNodeId: "n_script",
    sourceSceneIndex: sceneIdx - 1,
    autoSyncWithScript: true,
    audioAssignments: [],
    videoProvider: "veo3.1",
    generatedVideoResults: [exampleResult("video", 2000 + sceneIdx)],
    activeVideoResultIndex: 0,
    generatedVideoUrl: `${R2_BASE}/users/abc123/scenes/scene_${sceneIdx}_video.mp4`,
    videoExecutionStatus: "completed",
  },
  width: 520,
  height: 640,
})

const sceneNodes: WorkflowNode[] = [
  makeSceneImageNode(1, "Wide establishing shot — cliff at golden hour", false),
  makeSceneImageNode(2, "Medium back-of-figure — wind in coat", false),
  makeSceneImageNode(3, "Close-up profile — Mira's face on horizon", false),
  makeSceneImageNode(4, "Wide reveal — Kai emerging on path", false),
  makeSceneImageNode(5, "Two-shot dolly — siblings on cliff", false),
  makeSceneImageNode(6, "Close-up — Kai's soft worry", false),
  makeSceneImageNode(7, "Wide — Kai retreats, Mira alone", false),
  makeSceneImageNode(8, "Cottage interior — Elena at stove", true),
]

// ── Stage 6: 8 animated video (image-to-video) nodes ───────────────

const makeI2vNode = (sceneIdx: number): WorkflowNode => ({
  id: `n_i2v_${sceneIdx}`,
  type: "image-to-video",
  position: { x: sceneIdx * 540, y: 3120 },
  data: {
    label: `Animate Scene ${sceneIdx}`,
    provider: "veo3.1",
    model: "veo3.1",
    duration: 8,
    motion: "subtle",
    motionEnabled: true,
    prompt:
      sceneIdx === 1
        ? "Wind catches grass and coat fabric. Subtle parallax on horizon. Camera holds static."
        : sceneIdx === 2
          ? "Subtle push-in. Coat fabric ripples in wind. Hair shifts slightly."
          : sceneIdx === 3
            ? "Eyes blink slowly. Faint breath visible at temple. Background bokeh shifts."
            : sceneIdx === 4
              ? "Kai's silhouette walks slowly into frame, hands in pockets, head down."
              : sceneIdx === 5
                ? "Slow dolly. Mira holds position. Kai's mouth moves as he speaks (line 1)."
                : sceneIdx === 6
                  ? "Subtle expression shift — concern deepens. Hair shifts in wind."
                  : sceneIdx === 7
                    ? "Kai exits frame up the path. Mira's stillness holds. Wind continues."
                    : "Steam rises from pot. Elena's shoulders rise on a sigh. Lamp flickers briefly.",
    negativePrompt: "fast motion, jump cuts, distorted face, hallucinated objects, text on screen",
    generateAudio: false,
    fieldMappings: {},
    executionStatus: "completed",
    generatedVideoUrl: `${R2_BASE}/users/abc123/videos/scene_${sceneIdx}_animated.mp4`,
    generatedResults: [exampleResult("video", 3000 + sceneIdx)],
    activeResultIndex: 0,
    aspectRatio: "16:9",
    resolution: "1080p",
    seed: 99_000 + sceneIdx,
    selectedStartFrameNodeId: `n_scene_${sceneIdx}`,
    currentJobId: `job_i2v_${sceneIdx}`,
    currentJobProgress: 100,
    kieTaskId: `kie_task_veo_${sceneIdx}_${"x".repeat(16)}`,
    connectedImageOrder: [`n_scene_${sceneIdx}`],
    veoMode: "frame-to-frame",
    loopTrim: {
      enabled: false,
    },
    enableTranslation: false,
  },
  width: 420,
  height: 400,
})

const i2vNodes: WorkflowNode[] = []
for (let s = 1; s <= 8; s++) {
  i2vNodes.push(makeI2vNode(s))
}

// ── Stage 7: Audio nodes (narration + dialogue + lip-sync + music + sfx)

// 2 narration nodes (text-to-speech)
const makeNarrationNode = (idx: number, text: string): WorkflowNode => ({
  id: `n_narration_${idx}`,
  type: "text-to-speech",
  position: { x: idx * 520, y: 3920 },
  data: {
    label: `Narration ${idx}`,
    provider: "elevenlabs-v3",
    voiceId: "el_narrator_voice_main",
    voiceLabel: "Quiet Narrator (Mid-30s feminine)",
    voiceType: "premade",
    voiceDisplayName: "Quiet Narrator",
    language: "en",
    languageCode: "en-US",
    speed: 0.95,
    stability: 0.65,
    similarityBoost: 0.75,
    style: 0.3,
    textSource: "direct",
    directText: text,
    fieldMappings: {},
    executionStatus: "completed",
    generatedAudioUrl: `${R2_BASE}/users/abc123/audio/narration_${idx}.mp3`,
    generatedResults: [exampleResult("audio", 4000 + idx)],
    activeResultIndex: 0,
  },
  width: 360,
  height: 320,
})

const narrationNodes: WorkflowNode[] = [
  makeNarrationNode(
    1,
    "She stood at the edge for a long time, watching the water. " +
      "It was the kind of stillness people mistake for peace.",
  ),
  makeNarrationNode(
    2,
    "Inside, her mother stirred a pot and listened for footsteps " +
      "that did not come. Some days, the sea kept them all.",
  ),
]

// 4 dialogue nodes (text-to-speech using designed character voices)
const makeDialogueNode = (idx: number, charIdx: number, text: string): WorkflowNode => ({
  id: `n_dialogue_${idx}`,
  type: "text-to-speech",
  position: { x: idx * 380, y: 4280 },
  data: {
    label: `Dialogue ${idx}`,
    provider: "elevenlabs-v3",
    voiceId: `el_voice_designed_${charIdx}`,
    voiceLabel: `${charIdx === 1 ? "Mira" : charIdx === 2 ? "Kai" : "Elena"} (designed)`,
    voiceType: "custom",
    voiceDisplayName: charIdx === 1 ? "Mira" : charIdx === 2 ? "Kai" : "Elena",
    language: "en",
    languageCode: "en-US",
    speed: 0.92,
    stability: 0.6,
    similarityBoost: 0.8,
    style: 0.35,
    textSource: "direct",
    directText: text,
    fieldMappings: {},
    executionStatus: "completed",
    generatedAudioUrl: `${R2_BASE}/users/abc123/audio/dialogue_${idx}.mp3`,
    generatedResults: [exampleResult("audio", 5000 + idx)],
    activeResultIndex: 0,
  },
  width: 360,
  height: 320,
})

const dialogueNodes: WorkflowNode[] = [
  makeDialogueNode(1, 2, "You came back."),
  makeDialogueNode(2, 1, "I never left."),
  makeDialogueNode(3, 3, "Did you find her?"),
  makeDialogueNode(4, 2, "She's at the cliff. Same as always."),
]

// 4 lip-sync nodes
const makeLipSyncNode = (idx: number, sceneIdx: number, dialogueIdx: number): WorkflowNode => ({
  id: `n_lipsync_${idx}`,
  type: "lip-sync",
  position: { x: idx * 520, y: 4680 },
  data: {
    label: `Lip Sync ${idx}`,
    provider: "kling-avatar-pro",
    resolution: "720p",
    prompt: "Soft, natural mouth movement. Maintain identity. Frame stable.",
    fieldMappings: {},
    executionStatus: "completed",
    generatedVideoUrl: `${R2_BASE}/users/abc123/videos/lipsync_${idx}.mp4`,
    generatedResults: [exampleResult("video", 6000 + idx)],
    activeResultIndex: 0,
    selectedVideoNodeId: `n_i2v_${sceneIdx}`,
    selectedAudioNodeId: `n_dialogue_${dialogueIdx}`,
    audioDurationSec: 3.4,
    currentJobId: `job_lipsync_${idx}`,
    currentJobProgress: 100,
  },
  width: 420,
  height: 360,
})

const lipSyncNodes: WorkflowNode[] = [
  makeLipSyncNode(1, 5, 1), // Kai: "You came back."
  makeLipSyncNode(2, 5, 2), // Mira: "I never left."
  makeLipSyncNode(3, 8, 3), // Elena: "Did you find her?"
  makeLipSyncNode(4, 8, 4), // Kai: "She's at the cliff."
]

// 1 music node
const musicNode: WorkflowNode = {
  id: "n_music",
  type: "generate-music",
  position: { x: 0, y: 5060 },
  data: {
    label: "Score",
    prompt:
      "Ambient orchestral score, low strings and sparse piano. Subtle wave " +
      "texture underneath. Mood: contemplative, weary, with a faint warmth. " +
      "Build slowly across 40 seconds. End on a soft sustain.",
    provider: "suno",
    duration: 60,
    genre: "ambient-orchestral",
    mood: "contemplative",
    instrumental: true,
    lyrics: "",
    referenceAudioUrl: "",
    referenceYouTubeUrl: "",
    referenceSource: "none",
    modelVersion: "v5",
    fieldMappings: {},
    executionStatus: "completed",
    generatedAudioUrl: `${R2_BASE}/users/abc123/audio/score.mp3`,
    generatedResults: [exampleResult("audio", 7000)],
    activeResultIndex: 0,
  },
  width: 360,
  height: 340,
}

// 2 SFX nodes
const makeSfxNode = (idx: number, prompt: string): WorkflowNode => ({
  id: `n_sfx_${idx}`,
  type: "text-to-audio",
  position: { x: idx * 380, y: 5420 },
  data: {
    label: `SFX ${idx}`,
    prompt,
    provider: "elevenlabs-sfx",
    duration: 20,
    loop: true,
    promptInfluence: 0.6,
    fieldMappings: {},
    executionStatus: "completed",
    generatedAudioUrl: `${R2_BASE}/users/abc123/audio/sfx_${idx}.mp3`,
    generatedResults: [exampleResult("audio", 8000 + idx)],
    activeResultIndex: 0,
  },
  width: 320,
  height: 280,
})

const sfxNodes: WorkflowNode[] = [
  makeSfxNode(1, "Continuous coastal wind, mid-to-low frequencies, gentle gusts. No vocal artifact."),
  makeSfxNode(2, "Distant gull cries, sparse, layered with low ocean swell."),
]

// ── Stage 8: Final merge ─────────────────────────────────────────────

const finalMergeNode: WorkflowNode = {
  id: "n_final",
  type: "combine-videos",
  position: { x: 1500, y: 5800 },
  data: {
    label: "Final Cut",
    transition: "fade",
    transitionDuration: 0.6,
    audioMode: "crossfade",
    clipOrder: [
      "n_i2v_1", "n_lipsync_1", "n_lipsync_2", "n_i2v_2", "n_i2v_3",
      "n_i2v_4", "n_i2v_5", "n_i2v_6", "n_i2v_7", "n_lipsync_3", "n_lipsync_4", "n_i2v_8",
    ],
    fieldMappings: {},
    executionStatus: "completed",
    generatedVideoUrl: `${R2_BASE}/users/abc123/videos/final_cut.mp4`,
    generatedResults: [exampleResult("video", 9000)],
    activeResultIndex: 0,
  },
  width: 420,
  height: 360,
}

// ── Assemble graph ──────────────────────────────────────────────────

const nodes: WorkflowNode[] = [
  scriptNode,
  shotListNode,
  ...charNodes,           // 3
  ...charVariantNodes,    // 18 (3 char × 6 variants)
  ...voiceDesignNodes,    // 3
  ...locNodes,            // 2
  ...locVariantNodes,     // 4
  ...sceneNodes,          // 8
  ...i2vNodes,            // 8
  ...narrationNodes,      // 2
  ...dialogueNodes,       // 4
  ...lipSyncNodes,        // 4
  musicNode,              // 1
  ...sfxNodes,            // 2
  finalMergeNode,         // 1
]
// total: 2 + 3 + 18 + 3 + 2 + 4 + 8 + 8 + 2 + 4 + 4 + 1 + 2 + 1 = 62

// ── Edges ────────────────────────────────────────────────────────────

const edges: WorkflowEdge[] = []
let edgeSeq = 0
const makeEdgeId = () => `e_${(++edgeSeq).toString(36)}_${Math.random().toString(36).slice(2, 8)}`

// Script → Shot list
edges.push({
  id: makeEdgeId(),
  source: "n_script",
  target: "n_shotlist",
  sourceHandle: "text",
  targetHandle: "in",
})

// Each character main → its variants
for (let c = 1; c <= 3; c++) {
  for (let i = 0; i < 3; i++) {
    edges.push({
      id: makeEdgeId(),
      source: `n_char_${c}`,
      sourceHandle: "characterRef",
      target: `n_char_${c}_angle_${i}`,
      targetHandle: "reference",
    })
    edges.push({
      id: makeEdgeId(),
      source: `n_char_${c}`,
      sourceHandle: "characterRef",
      target: `n_char_${c}_emotion_${i}`,
      targetHandle: "reference",
    })
  }
}
// Each character → voice design
for (let c = 1; c <= 3; c++) {
  edges.push({
    id: makeEdgeId(),
    source: `n_char_${c}`,
    sourceHandle: "characterRef",
    target: `n_voice_${c}`,
    targetHandle: "characterRef",
  })
}

// Each location main → its variants
for (let l = 1; l <= 2; l++) {
  for (let i = 0; i < 2; i++) {
    edges.push({
      id: makeEdgeId(),
      source: `n_loc_${l}`,
      sourceHandle: "locationRef",
      target: `n_loc_${l}_var_${i}`,
      targetHandle: "reference",
    })
  }
}

// Each scene image fans in from:
//  - script (1 edge)
//  - 1-2 characters
//  - 1 location
// Then scene → i2v
const sceneCharRefs: Record<number, number[]> = {
  1: [1], 2: [1], 3: [1], 4: [1, 2], 5: [1, 2], 6: [2], 7: [1], 8: [2, 3],
}
for (let s = 1; s <= 8; s++) {
  edges.push({
    id: makeEdgeId(),
    source: "n_script",
    sourceHandle: "text",
    target: `n_scene_${s}`,
    targetHandle: "script",
  })
  for (const c of sceneCharRefs[s] ?? []) {
    edges.push({
      id: makeEdgeId(),
      source: `n_char_${c}`,
      sourceHandle: "characterRef",
      target: `n_scene_${s}`,
      targetHandle: `character_${c}`,
    })
  }
  edges.push({
    id: makeEdgeId(),
    source: s === 8 ? "n_loc_2" : "n_loc_1",
    sourceHandle: "locationRef",
    target: `n_scene_${s}`,
    targetHandle: "location",
  })
  // Scene → i2v
  edges.push({
    id: makeEdgeId(),
    source: `n_scene_${s}`,
    sourceHandle: "image",
    target: `n_i2v_${s}`,
    targetHandle: "image",
  })
}

// Voice designs → dialogue nodes
const dialogueVoiceMap: Record<number, number> = { 1: 2, 2: 1, 3: 3, 4: 2 }
for (const [dialogueIdx, charIdx] of Object.entries(dialogueVoiceMap)) {
  edges.push({
    id: makeEdgeId(),
    source: `n_voice_${charIdx}`,
    sourceHandle: "voiceRef",
    target: `n_dialogue_${dialogueIdx}`,
    targetHandle: "voice",
  })
}

// Dialogue + scene → lip-sync
const lipSyncMap: Array<[number, number, number]> = [
  [1, 5, 1], [2, 5, 2], [3, 8, 3], [4, 8, 4],
]
for (const [lsIdx, sceneIdx, dialogueIdx] of lipSyncMap) {
  edges.push({
    id: makeEdgeId(),
    source: `n_i2v_${sceneIdx}`,
    sourceHandle: "video",
    target: `n_lipsync_${lsIdx}`,
    targetHandle: "video",
  })
  edges.push({
    id: makeEdgeId(),
    source: `n_dialogue_${dialogueIdx}`,
    sourceHandle: "audio",
    target: `n_lipsync_${lsIdx}`,
    targetHandle: "audio",
  })
}

// All i2v + lip-sync → final merge (audio handled at merge)
const finalSources = [
  "n_i2v_1", "n_i2v_2", "n_i2v_3", "n_i2v_4",
  "n_i2v_5", "n_i2v_6", "n_i2v_7", "n_i2v_8",
  "n_lipsync_1", "n_lipsync_2", "n_lipsync_3", "n_lipsync_4",
]
for (const src of finalSources) {
  edges.push({
    id: makeEdgeId(),
    source: src,
    sourceHandle: "video",
    target: "n_final",
    targetHandle: "in",
  })
}

// Music + SFX + narration → final merge
edges.push({
  id: makeEdgeId(),
  source: "n_music",
  sourceHandle: "audio",
  target: "n_final",
  targetHandle: "music",
})
edges.push({
  id: makeEdgeId(),
  source: "n_sfx_1",
  sourceHandle: "audio",
  target: "n_final",
  targetHandle: "sfx",
})
edges.push({
  id: makeEdgeId(),
  source: "n_sfx_2",
  sourceHandle: "audio",
  target: "n_final",
  targetHandle: "sfx",
})
edges.push({
  id: makeEdgeId(),
  source: "n_narration_1",
  sourceHandle: "audio",
  target: "n_final",
  targetHandle: "narration",
})
edges.push({
  id: makeEdgeId(),
  source: "n_narration_2",
  sourceHandle: "audio",
  target: "n_final",
  targetHandle: "narration",
})

// ── The final workflow envelope ─────────────────────────────────────
//
// Matches the structure returned by `get_workflow_json`
// (`backend/src/lib/mcp/tools/workflows.ts:129`). Real responses also
// include id, name, description, project_id, updated_at, etc. but the
// majority of the payload is nodes + edges; the metadata adds ~300 bytes.

const TARGET_FILM_WORKFLOW = {
  id: "wf_film_director_target_50nodes",
  name: "Film Director — Mira at the Cliff",
  description:
    "Realistic Stage 1–8 Nodaro Film Director run. Two-character seaside " +
    "drama with 8 shots, full lip-sync, score, and SFX. Used for §5.4 " +
    "size auditing — see specs/features/mcp-tool-audit-2026-05-14.md.",
  project_id: "proj_film_abc123",
  updated_at: "2026-05-14T13:00:00.000Z",
  nodes,
  edges,
  settings: {},
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Film Director workflow size (Spec §5.4, Task F2)", () => {
  test("graph has at least 50 nodes and at least 80 edges", () => {
    expect(nodes.length).toBeGreaterThanOrEqual(50)
    expect(edges.length).toBeGreaterThanOrEqual(80)
  })

  test("serializes to under 100KB", () => {
    const json = JSON.stringify(TARGET_FILM_WORKFLOW)
    const sizeKB = json.length / 1024
    // Use process.stdout.write so the measurement appears even when vitest
    // suppresses test-body console.log. This is a one-line report intended
    // for the human auditor — see specs/features/mcp-tool-audit-2026-05-14.md.
    process.stdout.write(
      `\n[Spec §5.4 / F2] Film Director workflow measurement:\n` +
        `  Nodes:                          ${nodes.length}\n` +
        `  Edges:                          ${edges.length}\n` +
        `  Bytes:                          ${json.length.toLocaleString()} (${sizeKB.toFixed(1)} KB)\n` +
        `  Est. tokens (chars/4):          ${Math.ceil(json.length / 4).toLocaleString()}\n` +
        `  % of Claude 200K context:       ${((json.length / 4 / 200_000) * 100).toFixed(2)}%\n` +
        `  % of ChatGPT ~128K context:     ${((json.length / 4 / 128_000) * 100).toFixed(2)}%\n` +
        `  % of Gemini 1M context:         ${((json.length / 4 / 1_000_000) * 100).toFixed(3)}%\n\n`,
    )
    expect(sizeKB).toBeLessThan(100)
  })

  test("estimated token count under 25K (≤ 12.5% of Claude 200K context)", () => {
    const json = JSON.stringify(TARGET_FILM_WORKFLOW)
    const estimatedTokens = json.length / 4
    expect(estimatedTokens).toBeLessThan(25_000)
  })

  test("fits in ChatGPT's ~128K context with healthy headroom (under 25%)", () => {
    // ChatGPT (GPT-5 family) windows are typically ~128K. A 50-node Film
    // Director response should be a meaningful fraction but leave the
    // majority of the window for conversation history and downstream
    // tool results. 25% is the upper bound for "safe to fetch at start
    // of conversation" — much higher and the skill cannot reasonably
    // hold a long director-style dialog after the initial fetch.
    const json = JSON.stringify(TARGET_FILM_WORKFLOW)
    const fraction = json.length / 4 / 128_000
    expect(fraction).toBeLessThan(0.25)
  })
})
