---
"@nodaro/shared": minor
---

Video Remake (formerly Nodaro Motion): its engines are Nodaro Prism and Nodaro Pulse, with the public ids `"nodaro-prism"` and `"nodaro-pulse"`. `NODARO_MOTION_ENGINES`, `NODARO_MOTION_ENGINE_NAMES`, `nodaroMotionEngineOf` and `nodaroMotionEngineFrom` answer them. Every earlier id is still read wherever an engine is read (`castSwapEngineFrom`, `CAST_SWAP_ENGINE_IDS_ACCEPTED`) and answered as the current one; `NODARO_MOTION_EARLIER_ENGINES_OF` lists each engine's earlier ids, newest first.
