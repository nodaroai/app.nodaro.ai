---
"@nodaro/prompts": minor
---

New factory presets for creator-style videos.

- Voice Design: Casual Creator (female) and Casual Creator (male).
- Text to Audio: three loopable room tones — Living Room Tone, Kitchen Hum, Café Murmur.
- Image to Text: Site Screenshot Summary — section, headings, figures and brand from a web-page screenshot.
- Prompt: Hook Generator — ten opening lines for a talking-to-camera video.
- Add Captions: Hook Plate and Body Captions, and `hookPlateCaptionSegments(plan, options)`, which turns a `CaptionPlan` (the opening line, its end time and the timed words) into the `segments` of one add-captions request styled by the two presets; `options.bodyLevers` restyles the body. Exported with it: `CAPTION_LEVERS_BY_LANGUAGE`, `CAPTION_SEGMENT_LEVER_KEYS`, `HOOK_PLATE_PRESET_ID` and `BODY_CAPTIONS_PRESET_ID`.
