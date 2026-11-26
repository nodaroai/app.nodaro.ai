---
"@nodaro/sdk": minor
---

Generate Video and Text to Video take `dynamicRange?: "sdr" | "hdr"` (Kling 4.0, `kling-4` and `kling-4-keyframes`): `"hdr"` renders HDR (HEVC 10-bit, BT.2020, HLG) at `1080p` or `4k`, priced as an add-on on the output seconds. HDR at `720p`, or with no resolution, is refused with a `400` before anything is charged. Every other model ignores it.
