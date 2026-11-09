---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

Voice Library: how many voices each category, tone and language has, and each voice's tone and languages.

- `client.voices.libraryFacets(params?)` (`GET /v1/voices/library/facets`, public, no credits): for the listing's filters (`use_cases`, `language`, `descriptives`, `gender`, `age`, `accent`, `category`, `featured`, `search`), how many library voices match (`total`) and that number broken down by every facet — `use_cases`, `languages`, `descriptives`, `genders`, `ages`, `accents`, `categories` — each as `[{ value, count }]` sorted by count, zero counts left out, each facet ignoring its own filter so every category keeps its count while one is chosen. Counted over the platform's own copy of the library, refreshed on a schedule (`updatedAt`); `languages` counts a voice under every language it is verified for, which is what the listing's `language` filter matches. With `search` the counts are a lower estimate and `approximate` is true. For the few minutes after a deployment first reads the library the route answers `503 voice_library_warming` with `Retry-After`. Types `VoiceLibraryFacets`, `VoiceLibraryFacetCount`, `VoiceLibraryFacetsParams` (`@nodaro/shared/pipeline`, `@nodaro/sdk/voices`).
- `searchLibrary()` voices now carry `descriptive` (the library's one-word tone, `""` when it states none), `language` and `locale` (the primary language, `""` when unstated) and `verifiedLanguages` (every language code the voice is verified for, primary first), so a card can say "Cute · Spanish" without a second call.
- `VOICE_LIBRARY_DESCRIPTIVES` / `VoiceLibraryDescriptive` (`@nodaro/shared/pipeline`): the 34 tone words the library labels its voices with today, alphabetical (`anxious` … `wise`); `VoiceLibraryParams.descriptives` is typed to them and still takes any string — the facets route says which exist now.
