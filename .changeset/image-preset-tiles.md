---
"@nodaro/prompts": minor
---

Generate Image factory catalog: 307 ready-to-use tiles in thirteen user-facing groups — 187 content tiles (YouTube, Shorts · TikTok, Social & Ads, Business, Life & Events, Layout, Text) and 120 use cases (Business & Marketing, Personal Photos, Products & Fashion, Content & Creative, Home & Spaces, Family & Events), 58 of them edits of the person's own photo (`minReferences: 1`) — each with an example picture and its on-image headline as a `{TEXT || …}` slot. Two new optional fields on `FactoryPreset`: `section` (a sub-heading inside the group, such as a YouTube topic) and `platforms` (where the result is meant to be posted, most fitting first); `GET /v1/node-presets/factory` serves both.
