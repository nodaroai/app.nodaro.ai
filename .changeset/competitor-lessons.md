---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

What works for a brand (stage 4 of the research rollout): `@nodaro/shared` adds the lesson types (`BrandLesson`, `BrandPlatformLessons`, `BrandLessons`, `CompetitorLessonsResult`, `BRAND_LESSON_KINDS`); `@nodaro/sdk` adds `client.competitors.lessons(id)` (`GET /v1/competitors/:id/lessons`); `@nodaro/cli` adds `nodaro competitors lessons <id>`.

`socialSearchPostVideo` answers `{ kind: "none" }` for an image or a text post, which has no video to analyze.
