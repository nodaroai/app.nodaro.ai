---
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Search the saved characters, locations, objects and creatures by words: `q` on `characters.list()`, `locations.list()`, `objects.list()` and `creatures.list()` keeps the rows whose name or description contains every word of it (split on spaces, the first five), in any order and ignoring case — `"red car"` finds "Car, red" — and combines with every other filter and with cursor paging. `library.list()` takes the same `q` for its filename search; `search` still works and is deprecated. Each word is matched as written: `%`, `_` and `*` are not wildcards, and punctuation is kept. A blank `q` is no search. The CLI's `characters list`, `locations list` and `objects list` take `--search <words>` (or `--q <words>`). `q` needs a server from this release: an older one ignores it and returns the unfiltered list.
