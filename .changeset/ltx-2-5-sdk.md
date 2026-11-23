---
"@nodaro/sdk": minor
---

`GenerateVideoParams` and `TextToVideoParams` take `fps`: the frame rate on a model with a frame-rate setting (LTX 2.5: 24, 25, 48 or 50; default 24, the same price at each). LTX 2.5 Fast runs at most 10 s at 48 / 50 fps or 1440p, and a longer `duration` is priced and sent as 10 s and reported in `adjustments`. Every other model ignores it.
