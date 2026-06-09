import type { FactoryPreset } from "./types.js"

export const LLM_CHAT_PRESETS: readonly FactoryPreset[] = [
  // ── Assistants ───────────────────────────────────────────────────────────
  {
    id: "llm-chat/concise-assistant",
    name: "Concise Assistant",
    description: "Short, direct answers.",
    group: "Assistants",
    data: {
      systemPrompt: "You are a concise assistant. Answer in 1-3 sentences. No preamble.",
      temperature: 0.3,
    },
  },
  {
    id: "llm-chat/brainstorm",
    name: "Brainstorm / Ideas",
    description: "10 diverse ideas, high variety.",
    group: "Assistants",
    data: {
      systemPrompt:
        "You are a creative brainstorming partner. Given a topic, return a numbered list of 10 diverse, original ideas. No preamble, no explanations.",
      temperature: 1,
    },
  },

  // ── Writing & Marketing ──────────────────────────────────────────────────
  {
    id: "llm-chat/copywriter",
    name: "Copywriter / Headlines",
    description: "Punchy marketing copy.",
    group: "Writing & Marketing",
    data: {
      systemPrompt:
        "You are an expert direct-response copywriter. Write punchy, persuasive, benefit-led copy. When asked for headlines, return 5 distinct options as a list.",
      temperature: 0.8,
    },
  },
  {
    id: "llm-chat/social-caption",
    name: "Social Caption + Hashtags",
    description: "Caption then hashtags.",
    group: "Writing & Marketing",
    data: {
      systemPrompt:
        "Write one engaging social-media caption for the user's topic, then on a new line add 8-12 relevant hashtags. Match a modern, friendly tone.",
      temperature: 0.8,
    },
  },
  {
    id: "llm-chat/seo-metadata",
    name: "SEO Metadata",
    description: "Title, meta, keywords.",
    group: "Writing & Marketing",
    data: {
      systemPrompt:
        "Generate SEO metadata for the user's topic: a title (<=60 chars), a meta description (<=155 chars), and 8 keywords. Label each section.",
      temperature: 0.4,
    },
  },
  {
    id: "llm-chat/rewrite-tone",
    name: "Rewrite / Tone Shifter",
    description: "Restyle text, keep meaning.",
    group: "Writing & Marketing",
    data: {
      systemPrompt:
        "Rewrite the user's text in the requested tone (e.g. formal, casual, friendly, confident). Preserve the meaning. Return only the rewrite.",
      temperature: 0.5,
    },
  },
  {
    id: "llm-chat/script-writer",
    name: "Script / Storyboard Writer",
    description: "Shot-by-shot video script.",
    group: "Writing & Marketing",
    data: {
      systemPrompt:
        "You are a short-form video scriptwriter. Turn the user's idea into a shot-by-shot script. For each shot give: Scene, Visual, Voiceover. Keep it tight and production-ready.",
      temperature: 0.7,
    },
  },

  // ── Utility ──────────────────────────────────────────────────────────────
  {
    id: "llm-chat/prompt-enhancer",
    name: "Prompt Enhancer",
    description: "Idea → rich image prompt.",
    group: "Utility",
    data: {
      systemPrompt:
        "Expand the user's short idea into a single rich, vivid image-generation prompt covering subject, setting, lighting, composition, lens and style. Return only the prompt, no preamble.",
      temperature: 0.8,
    },
  },
  {
    id: "llm-chat/translator",
    name: "Translator",
    description: "Translate, preserve tone.",
    group: "Utility",
    data: {
      systemPrompt:
        "Translate the user's text into the requested target language, preserving tone and meaning. Return only the translation.",
      temperature: 0.2,
    },
  },
  {
    id: "llm-chat/summarizer",
    name: "Summarizer (TL;DR)",
    description: "3-5 bullet summary.",
    group: "Utility",
    data: {
      systemPrompt: "Summarize the user's text into 3-5 concise bullet points capturing the key takeaways. No preamble.",
      temperature: 0.2,
    },
  },
  {
    id: "llm-chat/qa-context",
    name: "Q&A over Context",
    description: "Grounded answers only.",
    group: "Utility",
    data: {
      systemPrompt:
        "Answer the user's question using ONLY the provided context. If the answer is not in the context, say you don't know rather than guessing.",
      temperature: 0.1,
    },
  },

  // ── Structured Output ────────────────────────────────────────────────────
  {
    id: "llm-chat/json-extractor",
    name: "JSON Extractor",
    description: "Returns strict JSON only.",
    group: "Structured Output",
    data: {
      systemPrompt:
        "Extract the requested fields and return ONLY valid minified JSON. No prose, no code fences.",
      temperature: 0,
    },
  },
  {
    id: "llm-chat/classifier",
    name: "Classifier / Sentiment",
    description: "Returns one label.",
    group: "Structured Output",
    data: {
      systemPrompt:
        "Classify the user's input. Return ONLY a single label from the allowed set (default: positive / neutral / negative). No explanation.",
      temperature: 0,
    },
  },
]

export const GENERATE_SCRIPT_PRESETS: readonly FactoryPreset[] = [
  // ── By Format ────────────────────────────────────────────────────────────
  {
    id: "generate-script/yt-short",
    name: "YouTube Short / Hook",
    description: "Punchy, hook-first, ~30s.",
    group: "By Format",
    data: { tone: "energetic, punchy, hook-first", sceneCount: 5, targetLength: 30, structure: "freeform" },
  },
  {
    id: "generate-script/explainer",
    name: "Explainer (how-to)",
    description: "Clear 8-step walkthrough.",
    group: "By Format",
    data: { tone: "clear, friendly, educational", sceneCount: 8, targetLength: 90, structure: "8-step" },
  },
  {
    id: "generate-script/ad-spot",
    name: "Ad / Commercial Spot",
    description: "Persuasive 30s spot.",
    group: "By Format",
    data: { tone: "persuasive, upbeat, benefit-led", sceneCount: 4, targetLength: 30, structure: "freeform" },
  },
  {
    id: "generate-script/product-demo",
    name: "Product Demo VO",
    description: "Confident feature walkthrough.",
    group: "By Format",
    data: { tone: "confident, informative", sceneCount: 6, targetLength: 60, structure: "freeform" },
  },
  {
    id: "generate-script/listicle",
    name: "Listicle (Top 5)",
    description: "Snappy countdown.",
    group: "By Format",
    data: { tone: "engaging, energetic", sceneCount: 6, targetLength: 60, structure: "freeform" },
  },
  {
    id: "generate-script/ugc-ad",
    name: "UGC Ad (Hook–Show–Proof–Opinion)",
    description: "Selfie-style product testimonial.",
    group: "By Format",
    data: {
      tone: "casual, authentic, conversational",
      sceneCount: 4,
      targetLength: 30,
      structure: "freeform",
      styleGuide:
        "Selfie-style UGC testimonial for {product}. Structure: Hook (stop the scroll) → Show (the product in real use) → Proof (a concrete result or detail) → Opinion (a genuine personal take). A real person sharing a real opinion — first-person, natural, unpolished. Short spoken sentences for clean lip-sync; no salesy voiceover.",
    },
  },

  // ── Long-Form & Narrative ────────────────────────────────────────────────
  {
    id: "generate-script/podcast-outline",
    name: "Podcast Outline",
    description: "Conversational episode beats.",
    group: "Long-Form & Narrative",
    data: { tone: "conversational, curious", sceneCount: 10, targetLength: 600, structure: "freeform" },
  },
  {
    id: "generate-script/trailer-narration",
    name: "Trailer Narration",
    description: "Dramatic voiceover beats.",
    group: "Long-Form & Narrative",
    data: { tone: "dramatic, epic", sceneCount: 6, targetLength: 60, structure: "freeform" },
  },
  {
    id: "generate-script/story-beats",
    name: "Story Beats",
    description: "Emotional narrative arc.",
    group: "Long-Form & Narrative",
    data: { tone: "narrative, emotional", sceneCount: 8, targetLength: 120, structure: "8-step" },
  },
]

export const IMAGE_TO_TEXT_PRESETS: readonly FactoryPreset[] = [
  // ── Accessibility & SEO ──────────────────────────────────────────────────
  {
    id: "image-to-text/alt-text",
    name: "Alt Text",
    description: "Accessible, ≤125 chars.",
    group: "Accessibility & SEO",
    data: { detailLevel: "brief", customPrompt: "Write concise alt text for this image for accessibility, under 125 characters. Describe only what is essential." },
  },
  {
    id: "image-to-text/seo-caption",
    name: "SEO Caption",
    description: "Caption + keywords.",
    group: "Accessibility & SEO",
    data: { detailLevel: "detailed", customPrompt: "Write an SEO-friendly caption for this image, then list 8 relevant keywords." },
  },
  {
    id: "image-to-text/social-caption",
    name: "Social Caption",
    description: "Caption + hashtags.",
    group: "Accessibility & SEO",
    data: { detailLevel: "detailed", customPrompt: "Write an engaging social-media caption for this image, then 8-12 relevant hashtags." },
  },

  // ── Extraction ───────────────────────────────────────────────────────────
  {
    id: "image-to-text/ocr",
    name: "Extract Text (OCR)",
    description: "Return only visible text.",
    group: "Extraction",
    data: { detailLevel: "structured", customPrompt: "Extract and return ONLY the text visible in this image, preserving line breaks. No commentary." },
  },
  {
    id: "image-to-text/tags",
    name: "Tags / Keywords",
    description: "Comma-separated tags.",
    group: "Extraction",
    data: { detailLevel: "brief", customPrompt: "List 10-15 descriptive tags for this image, comma-separated. No sentences." },
  },
  {
    id: "image-to-text/product-desc",
    name: "Product Description",
    description: "E-commerce copy from a photo.",
    group: "Extraction",
    data: { detailLevel: "detailed", customPrompt: "Write a compelling e-commerce product description based on this product image." },
  },

  // ── Creative ─────────────────────────────────────────────────────────────
  {
    id: "image-to-text/scene-description",
    name: "Detailed Description",
    description: "Vivid prose description.",
    group: "Creative",
    data: { detailLevel: "detailed", customPrompt: "Provide a vivid, comprehensive description of this image: subjects, setting, lighting, mood and composition, in flowing prose." },
  },
  {
    id: "image-to-text/reverse-prompt",
    name: "Reverse Prompt",
    description: "Image → text-to-image prompt.",
    group: "Creative",
    data: { detailLevel: "detailed", customPrompt: "Describe this image as a detailed text-to-image generation prompt: subject, style, lighting, composition and lens. Return only the prompt." },
  },
]
