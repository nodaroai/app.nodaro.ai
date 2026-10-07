# Face-detector parity fixtures

- `rt4k-540p2-gop.mp4` — 26 frames (13 s, one GOP) of the 540p, 2 fps detection
  proxy the P3.0b holdout (2026-10-06) scored as `rt4k`: proxy frames 18–43,
  stream-copied from the keyframe at 9.0 s (`ffmpeg -ss 9 -i <proxy> -map 0:v:0
  -c copy -frames:v 26 -movflags +faststart -map_metadata -1`). Every frame
  decodes bit-identically to the same frame of the full proxy (`-f framemd5`
  compared, 26 of 26 equal).
- `rt4k-540p2-gop.ort-dets.json` — the holdout's onnxruntime-node detections on
  those frames (score ≥ 0.3, centre-form boxes), re-indexed from 0. No other
  detector's output is included.

**Footage:** *Round Table – 10 Years On – The stars of 2014-15 reminisce on
HISTORIC promotion season*, AFCB TV, via Wikimedia Commons
(<https://commons.wikimedia.org/wiki/File:Round_Table-_10_Years_On_-_The_stars_of_2014-15_reminisce_on_HISTORIC_promotion_season.webm>),
licensed CC BY 3.0 (<https://creativecommons.org/licenses/by/3.0/>). Changes: a
13-second excerpt from 26 min in, scaled from 4K to 960×540 and resampled to
2 fps (H.264), with the audio removed.
