---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Add a **ref-only** reference role that injects only the bare reference pointer — `reference image A` on image nodes, `@image_1` / `@video_1` / `@audio_1` on video nodes — with no `the {label} from …` phrase.

- `roleToPhrase("ref-only", binding)` returns the bare binding; `ref-only` is now the first curated preset for `wired-character` / `wired-location`.
- Plain image / video / audio references now **default** to ref-only (`DEFAULT_LABEL_BY_SOURCE` manual/wired-image → empty label). Character / location / object / animal asset defaults are unchanged.
- Video/audio label-less body tokens resolve to the bare `@kind_N` (was `the subject in @kind_N`).
