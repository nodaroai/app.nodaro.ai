# Prompt Wizard — Design Spec

**Date:** 2026-03-26
**Status:** Draft
**Replaces:** Current single-shot prompt helper (`POST /v1/prompt-helper/enhance`)

## Summary

Replace the current "auto-enhance" prompt helper with an interactive AI-powered wizard. The wizard analyzes a user's rough idea (or starts from scratch), generates a pre-filled form of 3-5 contextual questions with curated options, and builds a high-quality prompt from the user's selections. It also recommends the best model/provider for the described content.

**Key design principle:** Structure the output format, not the content. AI decides *what* to ask, but the shape of each question (label + dropdown options + optional freetext) is always the same. Predictable UI, smart questions.

## UX Flow

### Phase 1 — Input

1. User clicks the pink AI button on any prompt field (unchanged)
2. PromptHelperDialog opens with:
   - Textarea for rough idea (e.g., "a cat on a windowsill at sunset")
   - If node already has a prompt, it's pre-filled here
   - LLM model selector (unchanged)
   - "Build Prompt" button
3. If prompt is empty, wizard works in "build from scratch" mode

### Phase 2 — Review Form

4. AI analyzes the input + node context and returns a structured form
5. Each question rendered as a row:
   - Category label (e.g., "Lighting")
   - Dropdown with 4-6 AI-generated options, best one pre-selected
   - Each option has a label and optional short description
   - Last option is always "Custom..." — reveals an inline text input
6. If user started from scratch, AI picks 5 key categories (not all) with no pre-selection
7. Bottom actions: "Generate Prompt" and "Re-analyze" (back to Phase 1)

### Phase 3 — Result

8. Generated prompt shown in an editable textarea
9. If AI has a model recommendation: a card showing provider name, label, and reason with a one-click "Apply" button
10. Bottom actions: "Use This Prompt" (applies + closes) and "Back" (returns to Phase 2)

## API Design

### Endpoint

`POST /v1/prompt-helper/wizard`

Single endpoint, two actions. Credits charged per action (2 total for full wizard flow). Uses same `buildLlmCreditIdentifier("prompt-helper", llmModel)` as today.

### Analyze Action

**Request:**
```typescript
{
  action: "analyze",
  nodeType: string,             // "generate-image", "text-to-video", etc.
  prompt?: string,              // rough idea (optional — empty = build from scratch)
  provider?: string,            // current model on the node
  style?: string,               // current style preset on the config panel
  aspectRatio?: string,
  duration?: number,
  llmModel?: string,            // which LLM to use for analysis
  nodeContext?: {
    connectedInputTypes?: string[],  // e.g., ["image", "character", "face"]
    referenceImageCount?: number,   // 0 = none, 1+ = how many ref images connected
    hasSourceVideo?: boolean,
  }
}
```

**Response:**
```typescript
{
  jobId: string,
  questions: Array<{
    category: string,           // "subject", "lighting", etc.
    label: string,              // "What lighting sets the mood?"
    options: Array<{
      value: string,            // "golden-hour"
      label: string,            // "Golden Hour"
      description?: string,     // "Warm, soft light from low sun angle"
    }>,
    selected: string | null,    // pre-selected value (null if from scratch)
    allowCustom: true,          // always true
  }>
}
```

### Generate Action

**Request:**
```typescript
{
  action: "generate",
  nodeType: string,
  provider?: string,
  style?: string,
  aspectRatio?: string,
  duration?: number,
  llmModel?: string,
  selections: Array<{
    category: string,           // "lighting"
    value: string,              // "golden-hour" or custom text
    isCustom: boolean,
  }>,
  originalPrompt?: string,     // for context
  nodeContext?: {               // same as analyze, for model recommendations
    connectedInputTypes?: string[],
    referenceImageCount?: number,   // 0 = none, 1+ = how many ref images connected
    hasSourceVideo?: boolean,
  }
}
```

**Response:**
```typescript
{
  jobId: string,
  prompt: string,               // final generated prompt
  recommendedModel?: {
    provider: string,           // "flux" (or Suno model version e.g. "V5")
    field: string,              // "provider" (default) or "model" (for Suno)
    label: string,              // "Flux 1.1 Pro"
    reason: string,             // "Best for photorealistic images with fine detail"
  }
}
```

### Old Endpoint

Remove `POST /v1/prompt-helper/enhance` — the wizard subsumes it. Users who want "auto" behavior just click "Generate Prompt" without changing any pre-filled selections. Frontend `enhancePrompt()` replaced with `wizardAnalyze()` + `wizardGenerate()` in the same deploy — no backwards compatibility period needed since both are internal.

## Category Sets

AI picks 3-5 categories per prompt from the available set for that node type. Categories are not mandatory steps — AI skips categories the user has already covered.

### Image (generate-image, image-to-image)

| Key | Label | Example Options |
|-----|-------|-----------------|
| `subject` | Subject | Person, Animal, Object, Landscape, Architecture, Abstract |
| `environment` | Environment / Setting | Indoor, Outdoor urban, Nature, Studio, Underwater, Space |
| `lighting` | Lighting | Golden hour, Studio, Dramatic, Neon, Natural overcast, Moonlight |
| `camera-composition` | Camera & Composition | Close-up, Wide shot, Bird's eye, Low angle, Macro, Rule of thirds |
| `style-medium` | Style / Medium | Photorealistic, Anime, Oil painting, Watercolor, 3D render, Pixel art |
| `mood-tone` | Mood & Tone | Warm & Serene, Cold & Mysterious, Bright & Playful, Dark & Dramatic |
| `details-texture` | Details / Texture (optional) | Skin pores, Bokeh, Rain droplets, Fabric texture, Film grain |

**Note:** Camera & Composition adapts by style — photorealistic gets camera angles, watercolor/pixel art gets composition terms (centered, scattered, rule of thirds).

**Conditional category:** `reference-role` — only shown when reference images are connected (see Reference Image Roles section below).

**Excluded:** `edit-image` — its providers are utility operations (upscale, remove-bg, instruction-based editing) where subjective categories like lighting/mood don't apply. The wizard button is not shown on edit-image nodes.

### Video (text-to-video, image-to-video, video-to-video, motion-transfer, extend-video, speech-to-video)

| Key | Label | Example Options |
|-----|-------|-----------------|
| `subject-action` | Subject & Action | Walking, Running, Dancing, Talking, Transforming, Revealing |
| `environment` | Environment / Setting | Indoor, Outdoor, Urban, Nature, Abstract, Studio |
| `camera-movement` | Camera Movement | Pan left/right, Dolly in/out, Tracking, Crane, Static, Handheld |
| `pacing-speed` | Pacing / Speed | Slow-motion, Real-time, Fast-cut, Gradual acceleration, Time-lapse |
| `style-look` | Style / Look | Cinematic, Documentary, Dreamy, Handheld, Music video, Animation |
| `mood-tone` | Mood & Tone | Epic, Intimate, Tense, Joyful, Melancholic, Mysterious |

### Music (generate-music, suno-generate)

| Key | Label | Example Options |
|-----|-------|-----------------|
| `genre-style` | Genre / Style | Pop, Lo-fi, Orchestral, Electronic, Jazz, Rock, Hip-hop, Ambient |
| `mood-energy` | Mood & Energy | Melancholic, Upbeat, Aggressive, Dreamy, Triumphant, Peaceful |
| `instruments` | Instruments | Piano, Synth, Guitar, Strings, Drums, Brass, No preference |
| `tempo` | Tempo | Slow ballad, Mid-tempo groove, Fast/driving, Variable |
| `vocals` | Vocals | Male, Female, No vocals, Choir, Whispered, Harmonized |
| `production-style` | Production Style | Polished, Raw/Lo-fi, Ambient, Layered, Stripped-back |

### Audio / SFX (text-to-audio)

| Key | Label | Example Options |
|-----|-------|-----------------|
| `sound-type` | Sound Type | Ambient, Impact, Mechanical, Nature, UI/notification, Musical |
| `environment` | Environment | Indoor, Outdoor, Underwater, Space, Urban, Forest |
| `intensity` | Intensity | Subtle, Moderate, Dramatic, Explosive |
| `texture-quality` | Texture / Quality | Clean, Distorted, Reverb-heavy, Dry, Filtered |

### Excluded Node Types

- **`edit-image`** — Utility operations (upscale, remove-bg); wizard categories don't apply
- **`text-to-speech`** — Pure TTS, prompt is the text to speak, not a creative description
- **`lip-sync`** — Prompt is descriptive but minimal; not a good fit for multi-category wizard

## Reference Image Roles

When `nodeContext.referenceImageCount >= 1`, the AI adds **one `reference-role` question per connected image** to the form. These are additional to the standard 3-5 category questions.

**Question format per image:**

```
"What role(s) should Reference Image {N} play?"
```

**Options (multi-select — user can pick multiple):**
- **Character reference** — preserve identity, face, clothing exactly
- **Style / mood reference** — apply lighting, color palette, atmosphere only
- **Composition reference** — follow layout and framing
- **Scene / background reference** — use as environment, ignore subjects
- **Texture / material reference** — apply surface details and textures
- **Custom...**

A single image can serve multiple roles (e.g., character + style from the same image). The UI renders these as checkboxes rather than a dropdown.

**How the generate phase uses role assignments:**

The AI weaves explicit role instructions into the prompt. For example, with 2 reference images:

```
The first image defines both the character and the style.
Preserve the character's identity, face, and clothing exactly.
Also apply this image's lighting, color palette, and cinematic tone to the scene.

The second image defines the background environment.
Use its setting and atmosphere, but do not copy its subjects.
```

This pattern produces reliable results because it tells the model exactly what to extract from each reference instead of leaving it ambiguous.

**Response schema extension:**

Reference role questions use a modified structure with `multi: true` to support multi-select:

```typescript
{
  category: "reference-role-1",    // "reference-role-2", etc.
  label: string,                   // "What role(s) should Reference Image 1 play?"
  options: Array<{ value, label, description }>,
  selected: string[] | null,       // array of selected values (multi-select)
  allowCustom: true,
  multi: true,                     // renders as checkboxes instead of dropdown
}
```

The generate action receives multi-select values as a comma-joined string in the `selections` array (e.g., `value: "character,style-mood"`).

## Provider Capabilities (for Model Recommendation)

Lives in `packages/shared/src/prompt-wizard-categories.ts`. AI uses these descriptions to recommend the best provider. **Must be updated when providers are added** (add to Provider Enum Sync checklist in CLAUDE.md).

### generate-image

| Provider | Capability Description |
|----------|----------------------|
| `flux` | Photorealistic, highly detailed, best overall quality |
| `flux-flex` | Fast Flux variant, good quality at lower cost |
| `flux-kontext` | Character consistency, reference-image-aware generation |
| `flux-kontext-max` | Premium character consistency with highest detail |
| `nano-banana` | Fast generation, style flexibility, reference image support |
| `nano-banana-pro` | Higher quality Nano Banana with better detail |
| `nano-banana-2` | Latest Nano Banana with resolution options (1K/2K/4K) |
| `gpt-image` | Creative concepts, illustration, variable quality tiers |
| `grok` | General purpose, good text understanding |
| `imagen4` | Google's latest, strong photorealism and text rendering |
| `imagen4-fast` | Faster Imagen 4 variant |
| `imagen4-ultra` | Highest quality Imagen 4 |
| `ideogram-v3` | Best for typography, text-in-image, logos, reference images |
| `qwen` | Versatile, good prompt adherence |
| `seedream` | Artistic, painterly styles, creative interpretation |
| `seedream-5-lite` | Lighter Seedream, faster artistic generation |
| `z-image` | Experimental, novel generation approaches |

### image-to-image

| Provider | Capability Description |
|----------|----------------------|
| `nano-banana` | Fast style transfer and transformation |
| `nano-banana-pro` | Higher quality transformations |
| `grok-i2i` | General purpose image transformation |
| `flux-i2i` | High quality image-to-image with strong prompt adherence |
| `flux-pro-i2i` | Premium Flux transformation |
| `gpt-image-i2i` | Creative reinterpretation of source images |
| `ideogram-edit` | Instruction-based editing with text preservation |
| `ideogram-remix` | Style remixing while preserving structure |
| `ideogram-reframe` | Aspect ratio changes with AI fill |
| `qwen-i2i` | Versatile transformation |
| `qwen-edit` | Instruction-based editing |
| `seedream-edit` | Artistic style editing |
| `seedream-5-lite-i2i` | Light artistic transformation |
| `flux-kontext` | Character-consistent edits with reference awareness |
| `flux-kontext-max` | Premium character-consistent editing |

### text-to-video

| Provider | Capability Description |
|----------|----------------------|
| `minimax` | Versatile, good motion quality, reliable |
| `veo3` | Google's latest, photorealistic, audio generation support |
| `veo3.1` | Enhanced VEO with improved motion |
| `kling` | Cinematic, precise camera control, high motion quality |
| `kling-turbo` | Faster Kling generation |
| `kling-3.0` | Latest Kling with motion control and multi-shot |
| `grok` | General purpose video generation |
| `sora2-pro` | OpenAI premium, cinematic quality |
| `sora2` | OpenAI standard video generation |
| `seedance` | Dance and movement specialization |
| `wan` | Versatile, good for animations and transformations |
| `wan-turbo` | Faster Wan generation |
| `hailuo-standard` | Standard quality, cost-effective |
| `bytedance-lite` | Fast, lightweight generation |
| `bytedance-pro` | Higher quality ByteDance |
| `runway-kie` | Runway via KIE, strong cinematic quality |

### image-to-video

| Provider | Capability Description |
|----------|----------------------|
| `minimax` | Versatile animation from still images |
| `veo3` | Photorealistic animation with audio |
| `veo3.1` | Enhanced image animation |
| `kling` | Precise motion from stills, camera control |
| `kling-turbo` | Faster Kling animation |
| `kling-3.0` | Latest Kling with advanced motion |
| `kling-master` | Highest quality Kling |
| `seedance` | Dance/movement from still images |
| `hailuo-2.3-pro` | Premium Hailuo animation |
| `hailuo-2.3` | Standard Hailuo animation |
| `hailuo-standard` | Cost-effective animation |
| `sora2-pro` | Premium OpenAI animation |
| `sora2` | Standard OpenAI animation |
| `wan-i2v` | Versatile image-to-video |
| `wan-turbo` | Fast image animation |
| `bytedance-lite` | Fast, lightweight |
| `bytedance-pro` | Higher quality ByteDance |
| `bytedance-pro-fast` | Fast premium ByteDance |
| `grok-i2v` | General purpose animation |
| `runway-kie` | Cinematic image animation |

### video-to-video

| Provider | Capability Description |
|----------|----------------------|
| `wan` | Style transfer and video transformation |
| `luma-modify` | Video modification preserving structure |
| `runway-aleph` | Advanced video transformation |

### motion-transfer

| Provider | Capability Description |
|----------|----------------------|
| `kling` | Motion transfer with camera control |
| `kling-3.0` | Advanced motion transfer |
| `wan-animate-move` | Movement-based motion transfer |
| `wan-animate-replace` | Subject replacement with motion preservation |

### extend-video

| Provider | Capability Description |
|----------|----------------------|
| `veo-extend` | Extend VEO-generated videos |
| `runway-extend` | Extend Runway-generated videos |

### generate-music

| Provider | Capability Description |
|----------|----------------------|
| `minimax` | General music generation, multiple genres |

### suno-generate

| Model | Capability Description |
|-------|----------------------|
| `V4` | Standard Suno generation |
| `V4_5` | Improved quality and coherence |
| `V4_5PLUS` | Enhanced V4.5 with better production |
| `V4_5ALL` | Full-featured V4.5 |
| `V5` | Latest Suno with highest quality |

### text-to-audio

| Provider | Capability Description |
|----------|----------------------|
| `elevenlabs-sfx` | High quality sound effects and ambient audio |

## AI System Prompts

### Analyze System Prompt

The backend builds a dynamic system prompt containing:

1. **Persona** — Node-type-aware expert identity (e.g., "You are a visual design expert specializing in AI image generation")
2. **Available categories** — The full category set for the node type, from shared config
3. **Node context** — Current provider, style preset, aspect ratio, duration, connected inputs
4. **Instructions:**
   - Analyze the user's text and identify what's already specified
   - Pick 3-5 categories that would most improve the prompt (skip covered ones)
   - If prompt is empty, select up to 5 key categories with `selected: null` (AI chooses most essential ones — e.g., subject, environment, lighting, style, mood for image)
   - For each category, generate 4-6 contextually relevant options
   - Pre-select the best option based on the user's description
   - If a style preset is already selected on the node, still show the style-medium category but pre-select the matching option. User can change it in the form — the wizard's selection takes precedence over the config panel when generating the prompt
   - If connected inputs provide context (e.g., character entity), skip the subject category
5. **Output format** — Strict JSON matching the response schema. No markdown, no explanations.

### Generate System Prompt

1. **Persona** — Same node-type-aware expert
2. **User's selections** — All category/value pairs
3. **Provider capabilities** — The `PROVIDER_CAPABILITIES` map for this node type
4. **Instructions:**
   - Build a natural-language prompt from all selections
   - Keep concise: under 500 chars for image/video/audio
   - Preserve original user text if provided
   - Weave style/mood/lighting naturally, don't keyword-stuff
   - If a particular provider would excel at this content, include a `recommendedModel` with provider key, display label, and short reason
   - Output strict JSON: `{ "prompt": "...", "recommendedModel": { "provider": "...", "label": "...", "reason": "..." } }` — `recommendedModel` is optional
   - Backend parses the JSON and returns it in the API response

## Node Context Injection

The PromptHelperButton receives context from the config panel at click time:

| Context | Source | Purpose |
|---------|--------|---------|
| `currentProvider` | Node data `provider` field | AI knows current model, can recommend alternatives |
| `currentStyle` | Node data `style` field | AI skips style category if already set |
| `referenceImageCount` | Count edges on `image` input handle(s) | AI generates one `reference-role` question per connected image |
| `hasSourceVideo` | Check if `video` input handle has edge | AI adapts for transformation vs. generation |
| `connectedInputTypes` | Derive from connected edges + node types | AI skips covered categories (e.g., character connected = skip subject) |

Context is derived from the workflow store via `useWorkflowStore((s) => s.edges)` and `useWorkflowStore((s) => s.nodes)` — config panels already have access to these. No new props or API calls needed. The dialog collects context at mount time using the same pattern as `ai-writer-config.tsx`.

## Shared Package

`packages/shared/src/prompt-wizard-categories.ts` contains:

- `WizardCategory` type definition
- `IMAGE_WIZARD_CATEGORIES`, `VIDEO_WIZARD_CATEGORIES`, `MUSIC_WIZARD_CATEGORIES`, `AUDIO_WIZARD_CATEGORIES` arrays
- `getCategoriesForNodeType(nodeType: string)` helper
- `PROVIDER_CAPABILITIES` map (all node types, all providers)

Both frontend (for type-checking) and backend (for system prompt building) import from this file.

## Credit Handling (Two-Action Flow)

`creditGuard` is a preHandler middleware that runs once per request — it cannot handle two credit charges in one call. Each action (`analyze` and `generate`) is a **separate HTTP request**, so each gets its own `creditGuard` invocation naturally. No composite identifiers needed.

The Zod schema discriminates on the `action` field. Both actions use the same `buildLlmCreditIdentifier("prompt-helper", llmModel)` — same cost per call.

**Credit model:** Each action costs 1 credit charge regardless of flow. Minimum flow (analyze + generate) = 2 credits. Re-analyze = +1 credit each time. "Back" from Phase 3 to Phase 2 is free (no LLM call — just re-renders the form). Only "Re-analyze" (Phase 2 → Phase 1 → new analyze call) and "Generate Prompt" cost credits.

## Dialog Sizing

Current dialog uses `max-w-md` (428px) which is too small for the wizard form. Changes:

- Increase to `max-w-2xl` (672px) to accommodate 3-5 question rows
- Add `max-h-[85vh] overflow-y-auto` for scrolling on smaller screens
- Mobile: responsive padding `p-4 sm:p-6`, touch targets `h-10` on mobile (`h-8 sm:h-10`)
- Question rows stack vertically on mobile (single-column)

## Error Handling

The analyze action returns structured JSON from the LLM. Malformed responses are possible:

- Backend validates LLM response against a Zod schema matching the `questions` array structure
- If validation fails: return a 502 error with `code: "malformed_response"`, refund credits
- Frontend shows a "Something went wrong, try again" message with a retry button
- Generate action is simpler (JSON with `prompt` + optional `recommendedModel`) — same Zod validation pattern

## Provider Recommendation — Apply Flow

The `onAccept` callback must be extended to support model changes:

```typescript
// Old
onAccept: (enhancedPrompt: string) => void

// New
onAccept: (enhancedPrompt: string, modelChange?: { field: string, value: string }) => void
```

The `field` tells the config panel which node data key to update — `"provider"` for most nodes, `"model"` for Suno. This avoids corrupting Suno node data by writing to the wrong field.

Config panel call sites update to:
```typescript
onAccept={(prompt, modelChange) => onUpdate({
  prompt,
  ...(modelChange && { [modelChange.field]: modelChange.value })
})}
```

This produces a single `updateNodeData()` call, creating one atomic undo entry for both prompt and model changes.

**Single-provider node types** (generate-music, text-to-audio): AI omits `recommendedModel` from the generate response since there's only one option. No Apply button shown.

## What Changes

| Component | Change |
|-----------|--------|
| `prompt-helper-dialog.tsx` | Full rewrite — three-phase wizard UI, larger dialog |
| `prompt-helper-button.tsx` | Extend `onAccept` signature to `(prompt, modelChange?)`, collect node context from workflow store |
| `prompt-helper-styles.ts` | Keep file — `hasPromptConsumerType` is used by `prompt-context.ts` for presentation mode. Wizard does not use its style lists. |
| `backend/src/routes/prompt-helper.ts` | Rewrite — new `wizard` endpoint with analyze/generate actions |
| `backend/src/prompts/prompt-helper-system.ts` | Rewrite — two system prompts (analyze + generate) |
| `packages/shared/src/prompt-wizard-categories.ts` | New file — categories + provider capabilities |
| `frontend/src/lib/api.ts` | Replace `enhancePrompt()` with `wizardAnalyze()` + `wizardGenerate()` |
| Config panels (image, video, audio, music) | Update `onAccept` call sites to handle optional provider |
| `video-configs.tsx` | Add PromptHelperButton to SpeechToVideoConfig (currently missing) |
| `CLAUDE.md` | Add prompt-wizard-categories to Provider Enum Sync checklist |

## What Stays the Same

- The pink PromptHelperButton appearance and placement
- The `hasCredits()` gate
- `prompt-helper-styles.ts` (kept for `hasPromptConsumerType` used elsewhere)
- Style dropdown on config panels (node data `style` read from workflow store inside dialog)
- LLM model selector inside the dialog
- Credit billing via `buildLlmCreditIdentifier`
- All existing config panel fields and dropdowns

## v2 Ideas (Not in This Build)

- **Suno structure metatags** — Auto-generating `[Verse]`, `[Chorus]` from a Structure category
- **Wizard presets** — Save and reuse favorite category selections
- **Learning from history** — AI references user's past successful prompts
- **Prompt comparison** — Show before/after diff of original vs. generated prompt
