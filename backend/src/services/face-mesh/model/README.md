# Face landmark model — the pinned file

The face mesh behind `POST /v1/video-face-mesh` (`../draw-face-mesh.ts`) runs
Google MediaPipe's FaceLandmarker landmark model (478 points: the face's 468,
then the two irises) through `onnxruntime-node`. The file it loads is pinned:
the sha256 is checked at load (`../face-mesh-model.ts`), and a mismatch fails
the job deterministically.

| File | What it is | sha256 |
|---|---|---|
| `face_landmarks_detector.onnx` | MediaPipe's `face_landmarks_detector.tflite`, converted to ONNX (below). **The file production loads.** 4,921,007 bytes. | `bc826d2f6cb7a6c9ef9f3a2854217314f5a75ec5bae29486b85576b9cba77bb9` |
| `LICENSE.mediapipe.txt` | The model's Apache-2.0 licence (© The MediaPipe Authors), shipped beside the model | — |

Upstream, not committed (the ONNX file is what runs):

- the bundle, `face_landmarker.task` (float16, version 1; `latest` served the
  same bytes on 2026-11-02):
  <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task>,
  sha256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`;
- the landmark model inside it, `face_landmarks_detector.tflite`, sha256
  `c7d54204ce0448474c7f3fa9af494787c0965cbdd6f20fc72867e43046bd43d5` (its
  metadata: "Face mesh detection model v2", "Detects 478 face landmarks").

It replaced the basic `face_landmark.tflite` (468 points, a 192 × 192 crop) on
2026-11-02: that model read a singing mouth as barely open.

The drawing's edge lists (`../face-mesh-topology.ts`) are transcribed from the
same project's `mediapipe/python/solutions/face_mesh_connections.py`
(Apache-2.0); this model's first 468 points are that topology (checked below).

## Reproducing the converted file

With tf2onnx 1.16.1 and TensorFlow 2.15.1 on Python 3.11:

```sh
curl -fLO https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
shasum -a 256 face_landmarker.task                # 64184e22…
unzip face_landmarker.task face_landmarks_detector.tflite
shasum -a 256 face_landmarks_detector.tflite      # c7d54204…
python -m tf2onnx.convert --tflite face_landmarks_detector.tflite --output face_landmarks_detector.onnx --opset 13
```

tf2onnx does not write the same bytes twice: two conversions with the same
versions differ in the generated node names and order and in the graph's doc
string (the input path given), so a fresh file has its own sha256. The pin is
the committed file's own hash; what a conversion must reproduce is the
numbers. Checked 2026-11-02 on 233 crops (218 real faces from the two clips
below, 15 non-faces): a fresh conversion gives exactly the committed file's
outputs on onnxruntime-node, and both are within 0.003 px (the points) and
0.0005 (the presence logit) of the tflite itself run by TensorFlow Lite.

## What the graph takes and gives

- Input `input_12`: float32 `[N, 256, 256, 3]`, NHWC, **RGB**, values in
  **[0, 1]**: the tflite's own metadata says so (normalisation mean 0, std
  255; colour space RGB), and the check below agrees.
- Output `Identity`: `[N, 1, 1, 1434]` — 478 × (x, y, z), x and y in pixels of
  the 256 × 256 crop. The first 468 are the face (the points drawn); 468–477
  are the irises (5 each), not drawn.
- Output `Identity_1`: `[N, 1, 1, 1]` — the face presence logit (sigmoid > 0.5
  = a face, MediaPipe's own default): 8.3–15.1 on the singer below, a median
  of 11 on the faces it reads present, at most −2.77 on the non-faces checked.
- Output `Identity_2`: `[N, 1]` — `tongue_out` in the metadata ("Score of
  whether tongue is out of mouth"), already a probability. Never read.

## The check, on real frames (2026-11-02)

The crops are the app's own (`../face-mesh-crop.ts`: YuNet's face box, square
at 1.5 ×, turned level by the eyes, bilinear). Two clips: a 4 s 854 × 480 test
clip (one singer in close-up for 1.6 s, then two people) and Speaker Frames'
four-person fixture (`../../face-detect/__tests__/fixtures/`).

- **The input range.** Against MediaPipe's own FaceLandmarker (mediapipe
  1.2.0, IMAGE mode: each frame on its own, its own detector and crop) on the
  same 81 faces of the test clip, the app's points lie a mean 1.56 % of the
  face's height (points 10–152) away fed [0, 1] (median 1.17 %, p95 3.56 %),
  and 1.98 % fed [-1, 1] (p95 6.03 %). Fifteen non-face crops of about a face's
  size (four hands, a trophy, a shoe, a plant, a logo, car parts, flat gray,
  noise) all read under 0.06 present in [0, 1]; in [-1, 1] a car wheel reads
  0.80. MediaPipe's own pipeline finds none of the fixture's (small) faces, so
  the comparison is on the test clip alone.
- **The mouth.** The inner lips' opening (points 13–14) over the face's
  height, the singer's 39 frames: mean 3.48 %, max 9.51 % (the former model,
  same crops: 2.08 %, 5.07 %), following MediaPipe's own reading frame by
  frame (correlation 0.90; the former 0.82). MediaPipe's own pipeline reads it
  wider still (mean 4.80 %, max 9.83 %): it crops tighter. The app's crop at
  1.2 × instead of 1.5 × reads 4.89 %.
- **The topology.** On the 136 faces both models found, each of the first 468
  points lies a median 2.1 % of the face's height (at most 3.6 %) from the
  former model's point of the same index (36 % for a shuffled pairing).
- **Presence.** Of the 218 faces YuNet finds in the two clips, this model
  reads 139 present against the former's 152: it turns away strong profiles
  and a head turning in motion blur that the former drew, and keeps three the
  former turned away.

## What it costs (2026-11-02, onnxruntime-node 1.30.0, one intra-op thread)

| | This model | The former |
|---|---|---|
| One face, median (p95): Apple M4 Max | 3.4–3.5 ms (3.8) | 1.35–1.4 ms (1.5) |
| One face, median (p95): linux/arm64 (Docker on the same Mac) | 9.8–9.9 ms (10.6) | 2.8 ms (3.1) |
| The whole step's CPU a frame (`cpuMs`), the four-person fixture (M4 Max) | 56–61 ms | 47–51 ms |
| The same, the test clip (M4 Max) | 28–31 ms | 26–28 ms |
| The session alone, built and run on 200 real crops: the process's growth | 15–17 MiB (linux/arm64, macOS) | 8–9 MiB (linux/arm64), 12–13 MiB (macOS) |
| A whole run, onnxruntime and YuNet already loaded: the process's growth (macOS) | 81–99 MiB | 76–86 MiB |

`../face-mesh-budget.ts` holds the run to these.

## Changing the model

A new file is a new mesh: replace it, update `FACE_MESH_MODEL_SHA256` (and the
upstream hashes) in `../face-mesh-model.ts`, bump `VIDEO_FACE_MESH_RECIPE` in
`@nodaro/shared`, and look at the drawn frames again before it ships.
