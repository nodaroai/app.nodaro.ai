---
"@nodaro/prompts": minor
---

Music and voice pickers get photographic pictures: `SOUND_RENDER_SETS` holds a render for every option of Music Genre, Music Mood, Instrumentation, Voice Character and Voice Delivery, and with `lookPreviews: true` (Nodaro Cloud) `pickerOptionImageUrl` returns it in place of the 3D emoji or flag. New `pickerOptionImage(...)` returns `{ url, srcSet? }`: with `srcSet: true` in the picture options, every CDN render gets a `srcSet` over `RENDER_WIDTH_LADDER`, which the catalog projections carry as `imageSrcSet`. Every render URL (these and `LOOK_PREVIEW_SETS`) now points at `cdn.nodaro.ai/picker-renders/`, a key no account owns, so no user deletion or cleanup can remove a picker picture.
