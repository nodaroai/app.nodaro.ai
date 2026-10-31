# Face landmark model — the pinned file

The face mesh behind `POST /v1/video-face-mesh` (`../draw-face-mesh.ts`) runs
Google MediaPipe's face landmark model (468 points) through `onnxruntime-node`.
The file it loads is pinned: the sha256 is checked at load
(`../face-mesh-model.ts`), and a mismatch fails the job deterministically.

| File | What it is | sha256 |
|---|---|---|
| `face_landmark.onnx` | MediaPipe's `face_landmark.tflite`, converted to ONNX (below). **The file production loads.** | `2e1fedebb790b9a2b23856ca4182e1feadb39ad94a59014a7e65824d07a7d6c4` |
| `LICENSE.mediapipe.txt` | The model's Apache-2.0 licence (© The MediaPipe Authors), shipped beside the model | — |

Upstream: <https://storage.googleapis.com/mediapipe-assets/face_landmark.tflite>
(sha256 `1055cb9d4a9ca8b8c688902a3a5194311138ba256bcc94e336d8373a5f30c814`,
not committed: the ONNX file is what runs).

The drawing's edge lists (`../face-mesh-topology.ts`) are transcribed from the
same project's `mediapipe/python/solutions/face_mesh_connections.py`
(Apache-2.0).

## Reproducing the converted file

```sh
python -m tf2onnx.convert --tflite face_landmark.tflite --output face_landmark.onnx --opset 13
shasum -a 256 face_landmark.onnx   # 2e1fedeb…
```

Another tf2onnx version may serialize differently; the pinned hash is the
converted file's own.

## What the graph takes and gives

- Input `input_1`: float32 `[1, 192, 192, 3]`, NHWC, **RGB**, values in
  **[0, 1]**, as MediaPipe's own CPU graph feeds it. Checked on real crops
  (2026-10-31): the points land on the face the same in either range (the
  five YuNet landmarks within ~5 % of the face's width), but only [0, 1]
  turns a non-face away — a crop of a hand reads 0.005 present in [0, 1] and
  0.53 in [-1, 1].
- Output `conv2d_21`: `[1, 1, 1, 1404]` — 468 × (x, y, z), x and y in pixels of
  the 192 × 192 crop.
- Output `conv2d_31`: `[1, 1, 1, 1]` — the face presence logit (sigmoid > 0.5 =
  a face).

## Changing the model

A new file is a new mesh: replace it, update `FACE_MESH_MODEL_SHA256` in
`../face-mesh-model.ts`, bump `VIDEO_FACE_MESH_RECIPE` in `@nodaro/shared`, and
look at the drawn frames again before it ships.
