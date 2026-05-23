# Collect

Aggregate multiple inputs into per-type arrays. The Collect node has one input handle that accepts any number of connections; outputs are dynamic, one per type present among the inputs.

## How it works

- Connect any nodes' outputs to the Collect node's `in` handle (left side).
- Collect groups them by output type (text, image, video, audio).
- Outputs appear on the right side, one per type with content.

## Order

The order of items in each output array is configurable from the Collect node's config panel — drag rows up/down to reorder. New connections append to the end.

## Pricing

Free — no credits charged.
