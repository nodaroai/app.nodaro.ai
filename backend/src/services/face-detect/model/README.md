# YuNet face detector — the pinned model

The face detector behind `tk.media.detectFaces` (`../detect-faces.ts`) runs this
model through `onnxruntime-node` 1.30.0. The file it loads is the **patched**
copy, and it refuses any other bytes: the sha256 is checked at load
(`../yunet-model.ts`), and a mismatch fails the job deterministically.

| File | What it is | sha256 |
|---|---|---|
| `face_detection_yunet_2023mar.onnx` | Upstream, unmodified (OpenCV Zoo, `models/face_detection_yunet/`, 232,589 bytes) | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `face_detection_yunet_2023mar-dyn.onnx` | The upstream file with its input made dynamic-shape (below). **The file production loads.** | `57acd73224bfbe2a2d6d28431da2e7c5b1d643717407e7cf2cae3d4a07ce2c14` |
| `patch_dyn.py` | The patch | — |
| `LICENSE.yunet.txt` | The model's MIT licence (© 2020 Shiqi Yu), shipped beside the model | — |

Upstream: <https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx>

## Why a patched copy

The upstream graph has a fixed `1×3×640×640` input. OpenCV's `FaceDetectorYN`
runs it at the frame's own size, padded to a multiple of 32, and that is the
operating point that was measured (the P3.0b holdout, 2026-10-06: 540p frames
padded to 960×544, score ≥ 0.7). onnxruntime enforces the declared shape, so
`patch_dyn.py` renames the input's height and width to the symbolic `H` and `W`
(and the outputs' anchor count to `N`) and drops the stored intermediate shapes.
No weight or operator changes. Resizing frames to 640×640 instead would be a
different, unmeasured detector.

## Reproducing the patched file

```sh
uv run --python 3.12 --with "onnx==1.19.0" \
  python patch_dyn.py face_detection_yunet_2023mar.onnx face_detection_yunet_2023mar-dyn.onnx
shasum -a 256 face_detection_yunet_2023mar-dyn.onnx   # 57acd732…
```

Made with Python 3.12.14 and `onnx` 1.19.0. The patch is deterministic (two runs
give the same bytes), but another `onnx` version may serialize differently; the
pinned hash is the patched file's own, and the parity test
(`../__tests__/detect-faces.parity.test.ts`) is what shows these bytes reproduce
the measured detections.

## Changing the model

A new file is a new detector: its recall and precision must be measured again
before it ships. Replace both files, update `YUNET_MODEL_SHA256` (and
`YUNET_UPSTREAM_SHA256` if the upstream changed) in `../yunet-model.ts`, and
re-record the parity fixture. The detector id written into every track set
(`yunet:2023mar-dyn@<hash prefix>`) changes with the hash, so stored tracks
name the model that produced them.
