---
"@nodaro/shared": minor
---

The language registry drops the `flag` emoji field. Flags are countries, languages are not: the mapping is many-to-many and politically loaded — Arabic is spoken across ~25 countries (which flag?), English carries the UK-vs-US problem, and pinning Hebrew to a national flag beside Arabic reads as a statement rather than a convenience. Flag emoji also render inconsistently across platforms and mean nothing to a screen reader.

Each language is now identified by its endonym (native name) plus its English name — unambiguous, self-identifying (a Hebrew reader finds עברית without reading English), and neutral. `LanguageDefinition.flag` and the per-entry values are removed; the language switcher and editor locale picker no longer render a flag.
