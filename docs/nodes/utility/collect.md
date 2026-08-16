# Collect

Aggregate multiple inputs into per-type arrays. The Collect node has one input handle that accepts any number of connections; outputs are dynamic, one per type present among the inputs.

## How it works

- Connect any nodes' outputs to the Collect node's `in` handle (left side).
- Collect groups them by output type (text, image, video, audio).
- The four typed output pips (text / image / video / audio) are **always present** on the right side — wire downstream consumers first and run later, in any order. An empty lane simply emits nothing until a matching input produces results.
- Each pip behaves as a plain producer of its type: the `image` lane connects anywhere an uploaded image can (Image Collage, Generate Image references, Lip Sync, …), `video` anywhere a video can (Combine Videos, Trim, Merge Video & Audio, …), `audio` likewise (Mix Audio, Combine Audio, …), and `text` reaches both prompt inputs and the list consumers (Merge Lists, Sort, Remove Duplicates, Selector, Reduce). The lane's type is enforced — the `image` lane is rejected by a video-only input, and no lane is an identity ref.
- The node body previews what was collected, in order: image thumbnails, clamped text lines, and count chips for video/audio. Rendering is display-only — nothing executes and no credits are charged. Before the upstream nodes have produced results the body shows "N connections · waiting for results".

## Order

The order of items in each output array is configurable from the Collect node's config panel — drag rows up/down to reorder. New connections append to the end.

## Pricing

Free — no credits charged.
