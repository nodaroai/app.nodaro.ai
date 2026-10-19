---
"@nodaro/sdk": patch
---

Generate Mask has one type contract: `GenerateMaskParams` is now `@nodaro/shared`'s `GenerateMaskRequest` plus the session fields (`sessionId`, `origin`), and `GenerateMaskJobOutput` is `NodeJobOutput & GenerateMaskOutput`, instead of copies of the same fields. No public name is removed and the wire is unchanged. One modifier follows the shared contract: `GenerateMaskParams`' `imageUrl`, `prompt` and `threshold` are now `readonly`, as on `GenerateMaskRequest`. Passing a body is unaffected; only assigning to those fields of a variable typed `GenerateMaskParams` after creating it stops compiling.
