/** Factory snippet catalog (v1: image + video; audio/text follow later).
 *  Order within a category = menu order = pill quick-cycle order. */
import type { FactorySnippet } from "./types.js"

const B = ["image", "video"] as const
const I = ["image"] as const
const V = ["video"] as const

export const FACTORY_SNIPPETS: readonly FactorySnippet[] = [
  // ── Identity & Consistency (prompt) ──
  { id: "identity-lock", name: "Identity Lock", description: "Hard-preserve the person's identity vs the reference", text: "preserve the exact same face, facial features, eye color, age, and expression as the reference image — do not alter identity", target: "prompt", media: B, category: "Identity & Consistency" },
  { id: "same-person-as-reference", name: "Same Person as Reference", description: "Bind generation to the reference human", text: "the same person as in the reference image: identical face, hairstyle, build, and skin tone", target: "prompt", media: B, category: "Identity & Consistency" },
  { id: "edit-only-the-request", name: "Edit Only the Request", description: "Change one thing, freeze everything else (Kontext/gpt-image edit pattern)", text: "change only the requested element; keep the face, pose, lighting, framing, and everything else exactly the same", target: "prompt", media: I, category: "Identity & Consistency" },
  { id: "wardrobe-lock", name: "Wardrobe Lock", description: "Outfit continuity across shots and edits", text: "wearing exactly the same outfit as the reference — same garments, colors, fabrics, and accessories, unchanged", target: "prompt", media: B, category: "Identity & Consistency" },
  { id: "no-beautify", name: "No Beautify", description: "Stop the model 'improving' a face", text: "preserve natural skin texture, age lines, and asymmetries; do not beautify, smooth, slim, or rejuvenate the face", target: "prompt", media: I, category: "Identity & Consistency" },

  // ── Quality (prompt) ──
  { id: "cinematic-quality", name: "Cinematic Quality", description: "Concrete film language that works on all modern models", text: "cinematic still, shallow depth of field, filmic color grade, soft motivated lighting, subtle film grain", target: "prompt", media: B, category: "Quality" },
  { id: "editorial-photo", name: "Editorial Photo", description: "Magazine-grade photographic quality", text: "professional editorial photography, sharp focus, balanced natural exposure, magazine-quality composition", target: "prompt", media: I, category: "Quality" },
  { id: "photoreal-anchor", name: "Photoreal Anchor", description: "Realism via camera language instead of 'realistic'", text: "photorealistic, shot on a full-frame camera, 50mm lens, natural color science, realistic skin tones", target: "prompt", media: I, category: "Quality" },
  { id: "crisp-detail", name: "Crisp Detail", description: "Detail booster that survives on modern models", text: "intricate fine detail, crisp micro-textures, tack-sharp focus on the subject", target: "prompt", media: B, category: "Quality" },
  { id: "polished-3d-render", name: "Polished 3D Render", description: "Quality language for CGI / product looks", text: "physically based rendering, ray-traced global illumination, studio HDRI reflections", target: "prompt", media: I, category: "Quality" },

  // ── Lighting (prompt) ──
  { id: "golden-hour", name: "Golden Hour", description: "Warm low sun", text: "bathed in warm golden-hour sunlight, long soft shadows, gentle lens flare", target: "prompt", media: B, category: "Lighting" },
  { id: "blue-hour", name: "Blue Hour", description: "Cool twilight mood", text: "cool blue-hour twilight, soft ambient dusk glow, practical lights just switching on", target: "prompt", media: B, category: "Lighting" },
  { id: "rembrandt-portrait", name: "Rembrandt Portrait", description: "Classic dramatic portrait key light", text: "Rembrandt lighting, single key at 45 degrees, triangle of light on the shadowed cheek, dark backdrop", target: "prompt", media: I, category: "Lighting" },
  { id: "studio-softbox", name: "Studio Softbox", description: "Clean commercial / product light", text: "clean studio lighting, large softbox key with gentle fill, seamless background, no harsh shadows", target: "prompt", media: B, category: "Lighting" },
  { id: "neon-noir", name: "Neon Noir", description: "Cyberpunk night palette", text: "neon signs reflecting on wet pavement, cyan and magenta rim light, moody cinematic glow", target: "prompt", media: B, category: "Lighting" },
  { id: "volumetric-rays", name: "Volumetric Rays", description: "Visible god-rays / atmosphere", text: "volumetric light rays cutting through haze, god rays, visible atmospheric dust", target: "prompt", media: B, category: "Lighting" },
  { id: "candlelit", name: "Candlelit", description: "Single warm practical source", text: "lit only by warm flickering candlelight, deep chiaroscuro shadows, intimate atmosphere", target: "prompt", media: B, category: "Lighting" },
  { id: "rim-backlight", name: "Rim Backlight", description: "Subject separation from the background", text: "strong backlight rim separating the subject from the background, glowing hair light", target: "prompt", media: B, category: "Lighting" },

  // ── Camera & Lens (prompt) ──
  { id: "85mm-portrait", name: "85mm Portrait", description: "Flattering portrait compression", text: "85mm portrait lens at f/1.8, creamy bokeh, flattering compression, tack-sharp eyes", target: "prompt", media: I, category: "Camera & Lens" },
  { id: "35mm-documentary", name: "35mm Documentary", description: "Natural reportage perspective", text: "35mm lens, documentary photography feel, natural perspective, candid framing", target: "prompt", media: B, category: "Camera & Lens" },
  { id: "wide-angle-24mm", name: "Wide Angle 24mm", description: "Sweeping environment / scale", text: "24mm wide-angle lens, expansive perspective, dramatic foreground-to-background depth", target: "prompt", media: B, category: "Camera & Lens" },
  { id: "macro-detail", name: "Macro Detail", description: "Extreme close texture work", text: "extreme macro close-up, 100mm macro lens, razor-thin focus plane, fine surface detail", target: "prompt", media: I, category: "Camera & Lens" },
  { id: "shallow-depth-of-field", name: "Shallow Depth of Field", description: "Bokeh subject isolation", text: "shallow depth of field at f/1.8, subject in crisp focus, background melting into soft bokeh", target: "prompt", media: B, category: "Camera & Lens" },
  { id: "deep-focus", name: "Deep Focus", description: "Everything sharp, landscape / architecture", text: "deep depth of field at f/11, sharp focus from foreground to horizon", target: "prompt", media: B, category: "Camera & Lens" },
  { id: "kodak-portra-look", name: "Kodak Portra Look", description: "Beloved warm-skin film stock", text: "shot on Kodak Portra 400, warm natural skin tones, gentle contrast, fine film grain", target: "prompt", media: B, category: "Camera & Lens" },
  { id: "cinestill-night-look", name: "CineStill Night Look", description: "Tungsten night-film aesthetic", text: "shot on CineStill 800T, tungsten white balance, teal shadows, halation glow around lights", target: "prompt", media: B, category: "Camera & Lens" },
  { id: "anamorphic-widescreen", name: "Anamorphic Widescreen", description: "Cinema lens character", text: "anamorphic widescreen, oval bokeh, subtle horizontal lens flares", target: "prompt", media: B, category: "Camera & Lens" },

  // ── Composition (prompt) ──
  { id: "rule-of-thirds", name: "Rule of Thirds", description: "Off-center balance", text: "composed on the rule of thirds, subject off-center, generous negative space", target: "prompt", media: B, category: "Composition" },
  { id: "extreme-close-up", name: "Extreme Close-Up", description: "Detail / emotion framing", text: "extreme close-up tightly framing the face, eyes as the focal point", target: "prompt", media: B, category: "Composition" },
  { id: "full-body-in-frame", name: "Full Body in Frame", description: "Forces head-to-toe (fights auto-cropping)", text: "full-body shot, entire figure visible head to toe, feet in frame", target: "prompt", media: B, category: "Composition" },
  { id: "overhead-flat-lay", name: "Overhead Flat Lay", description: "Top-down product / food", text: "top-down overhead shot, flat-lay composition, items neatly arranged on a clean surface", target: "prompt", media: I, category: "Composition" },
  { id: "low-angle-hero", name: "Low-Angle Hero", description: "Power / scale from below", text: "dramatic low-angle shot looking up at the subject, towering heroic perspective", target: "prompt", media: B, category: "Composition" },
  { id: "centered-symmetry", name: "Centered Symmetry", description: "Wes Anderson one-point look", text: "perfectly centered symmetrical composition, one-point perspective, meticulous balance", target: "prompt", media: B, category: "Composition" },

  // ── Realism (prompt) ──
  { id: "real-skin-texture", name: "Real Skin Texture", description: "The no-plastic-skin anchor", text: "natural skin texture with visible pores, fine lines, and subtle imperfections — no airbrushing", target: "prompt", media: B, category: "Realism" },
  { id: "candid-phone-photo", name: "Candid Phone Photo", description: "Amateurism reads as real", text: "candid unstaged smartphone photo, slightly imperfect framing, natural ambient light, casual realism", target: "prompt", media: I, category: "Realism" },
  { id: "film-grain", name: "Film Grain", description: "Grain breaks the synthetic-clean look", text: "subtle 35mm film grain, faint halation, natural sensor noise", target: "prompt", media: B, category: "Realism" },
  { id: "muted-true-color", name: "Muted True Color", description: "Kills the oversaturated AI grade", text: "muted naturalistic color palette, accurate white balance, restrained saturation", target: "prompt", media: B, category: "Realism" },
  { id: "lived-in-detail", name: "Lived-In Detail", description: "Anti-sterile environments", text: "lived-in scene with natural clutter, wear and tear, scuffed surfaces and dust", target: "prompt", media: B, category: "Realism" },

  // ── Text Rendering (prompt) ──
  { id: "legible-sign-text", name: "Legible Sign Text", description: "Verbatim text via quotes — replace YOUR TEXT", text: 'a sign that reads "YOUR TEXT" in clear, legible, correctly spelled lettering, high contrast against the background', target: "prompt", media: I, category: "Text Rendering" },
  { id: "clean-typography", name: "Clean Typography", description: "Poster / headline typography control", text: "bold sans-serif headline, accurate spelling rendered verbatim, professional kerning, clear negative space around the text", target: "prompt", media: I, category: "Text Rendering" },

  // ── Camera Motion (prompt, video) ──
  { id: "slow-dolly-in", name: "Slow Dolly-In", description: "The most reliable AI camera move", text: "slow steady dolly-in toward the subject, gradual and smooth", target: "prompt", media: V, category: "Camera Motion" },
  { id: "orbit-shot", name: "Orbit Shot", description: "Arc around the subject", text: "camera orbits smoothly around the subject at constant speed", target: "prompt", media: V, category: "Camera Motion" },
  { id: "tracking-shot", name: "Tracking Shot", description: "Follow movement from the side", text: "smooth tracking shot following the subject from the side", target: "prompt", media: V, category: "Camera Motion" },
  { id: "handheld-energy", name: "Handheld Energy", description: "Documentary realism", text: "handheld camera with subtle natural shake, documentary energy", target: "prompt", media: V, category: "Camera Motion" },
  { id: "crane-reveal", name: "Crane Reveal", description: "Vertical reveal", text: "crane shot rising slowly to reveal the full scene below", target: "prompt", media: V, category: "Camera Motion" },
  { id: "locked-tripod", name: "Locked Tripod", description: "Stops unwanted camera drift", text: "static locked-off tripod shot, fixed framing, no camera movement", target: "prompt", media: V, category: "Camera Motion" },
  { id: "fpv-fly-through", name: "FPV Fly-Through", description: "Drone racing energy", text: "FPV drone shot flying forward through the scene, fast and fluid", target: "prompt", media: V, category: "Camera Motion" },

  // ── Motion Quality (prompt, video) ──
  { id: "natural-physics", name: "Natural Physics", description: "Sora/Veo-era physics anchor", text: "natural realistic physics, accurate weight and momentum, grounded believable movement", target: "prompt", media: V, category: "Motion Quality" },
  { id: "cinematic-slow-motion", name: "Cinematic Slow Motion", description: "Graceful slo-mo", text: "smooth cinematic slow motion, graceful deliberate movement, fine detail visible", target: "prompt", media: V, category: "Motion Quality" },
  { id: "subtle-ambient-motion", name: "Subtle Ambient Motion", description: "i2v 'living photo' — prevents overshoot", text: "subtle natural motion only: gentle breathing, hair moving in the breeze, soft ambient movement", target: "prompt", media: V, category: "Motion Quality" },
  { id: "single-action-beat", name: "Single Action Beat", description: "One action + endpoint prevents loop failures", text: "performs one single continuous action, then settles naturally back into place", target: "prompt", media: V, category: "Motion Quality" },
  { id: "i2v-fidelity-lock", name: "I2V Fidelity Lock", description: "Animate without redrawing the input image", text: "keep the exact appearance, outfit, colors, and background from the input image; animate only the described motion", target: "prompt", media: V, category: "Motion Quality" },
  { id: "stable-scene-lock", name: "Stable Scene Lock", description: "Anti scene-mutation across the clip", text: "consistent lighting and stable framing throughout, the environment stays unchanged, no scene transitions", target: "prompt", media: V, category: "Motion Quality" },

  // ── Audio & Dialogue (prompt, video) ──
  { id: "ambient-sound-bed", name: "Ambient Sound Bed", description: "Audio: label syntax for audio-capable video models", text: "Audio: ambient environmental sound matching the scene, quiet room tone, no music", target: "prompt", media: V, category: "Audio & Dialogue" },
  { id: "no-subtitles", name: "No Subtitles", description: "The #1 Veo community staple (inline — these models have no negative field)", text: "(no subtitles, no on-screen text, no captions)", target: "prompt", media: V, category: "Audio & Dialogue" },
  { id: "silence-lock", name: "Silence Lock", description: "Stops AI gibberish-speech when no dialogue is wanted", text: "no dialogue, mouth closed, ambient sound only", target: "prompt", media: V, category: "Audio & Dialogue" },

  // ── Negative — Image (negative) ──
  { id: "anatomy-cleanup", name: "Anatomy Cleanup", description: "The classic hands/limbs scrub", text: "deformed hands, extra fingers, fused fingers, bad anatomy, extra limbs, distorted face", target: "negative", media: I, category: "Negative — Image" },
  { id: "watermark-scrub", name: "Watermark Scrub", description: "Stock-photo residue removal", text: "watermark, signature, text overlay, logo, username, jpeg artifacts", target: "negative", media: I, category: "Negative — Image" },
  { id: "low-quality-scrub", name: "Low-Quality Scrub", description: "Legacy quality negative (SD-era models)", text: "worst quality, low quality, lowres, blurry, out of focus, pixelated", target: "negative", media: I, category: "Negative — Image" },
  { id: "stray-text-scrub", name: "Stray Text Scrub", description: "Kills the gibberish-text habit", text: "text, captions, lettering, watermarks, logos", target: "negative", media: B, category: "Negative — Image" },
  { id: "ai-look-scrub", name: "AI-Look Scrub", description: "Kills plastic skin + HDR glow", text: "airbrushed, plastic skin, waxy smooth, overexposed HDR glow, oversaturated colors, beauty filter", target: "negative", media: B, category: "Negative — Image" },
  { id: "clutter-scrub", name: "Clutter Scrub", description: "Composition clarity", text: "cluttered composition, busy background, distracting elements", target: "negative", media: I, category: "Negative — Image" },
  { id: "garbled-text-scrub", name: "Garbled Text Scrub", description: "Text-rendering quality", text: "misspelled text, garbled letters, gibberish writing", target: "negative", media: I, category: "Negative — Image" },

  // ── Negative — Video (negative) ──
  { id: "artifact-scrub", name: "Artifact Scrub", description: "The big-three video failure modes", text: "morphing, warping, flickering, jitter, frame strobing, melting background", target: "negative", media: V, category: "Negative — Video" },
  { id: "body-stability", name: "Body Stability", description: "Anatomy over time", text: "extra limbs, duplicate limbs, face distortion, body deformation, floating objects", target: "negative", media: V, category: "Negative — Video" },
  { id: "camera-discipline", name: "Camera Discipline", description: "For locked shots — pairs with Locked Tripod", text: "camera drift, sudden zooms, handheld shake, unintended scene cuts", target: "negative", media: V, category: "Negative — Video" },
  { id: "identity-drift-scrub", name: "Identity Drift Scrub", description: "Video face stability (Kling/Wan)", text: "changing facial features, face morphing, identity drift, face distortion", target: "negative", media: V, category: "Negative — Video" },
]
