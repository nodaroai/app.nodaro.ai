# Component

> Embed a published Nodaro Component (reusable sub-workflow) from the marketplace directly into your workflow.

## Overview

The Component node lets you drop any published Component — a curated, versioned sub-workflow from the Nodaro marketplace or your own published apps — into your current workflow. The component's exposed inputs, settings, and outputs are surfaced directly in the config panel, so you configure and wire it just like any other node.

Components are versioned. The node records the version it was added at (`pinnedVersion`). When the component publisher releases a new version, you can refresh the node to pick it up. The credit cost is estimated from the component's content and shown in the config panel.

## When to Use

- Reuse a polished generation sub-workflow (e.g., a "Portrait Reel" template) across multiple projects without rebuilding it
- Drop in a community-published image or video pipeline as a black-box step
- Build complex, deeply-nested pipelines by composing multiple components

## Configuration

After adding a Component node from the toolbar, a picker dialog opens for you to choose the component. Once selected, the config panel shows:

| Section | Description |
|---------|-------------|
| **Inputs** | Input handles exposed by the component. Wired connections show "Connected from upstream"; unwired text inputs are editable inline. |
| **Settings** | Exposed settings the component author made configurable (text, number, select, toggle, aspect-ratio). Values are stored per `nodeId:field` key. |
| **Outputs** | Read-only list of output handles and their types. |

The credit estimate updates as you change settings (debounced 400 ms).

## Inputs & Outputs

**Inputs:** Dynamically determined by the component's exposed input handles (`in_<handleId>`). Type and required status are shown per handle in the config panel.

**Outputs:** Dynamically determined by the component's exposed output handles. Types include `text`, `image`, `video`, `audio`, and `json`.

## Pricing

Variable — determined by the nodes inside the component and the settings you configure. An estimated credit cost is shown in the config panel.

## Common Use Cases

- Include a "Remove Background + Upscale" component as a processing step in a larger pipeline
- Drop a community "Storyboard Generator" component and wire its video output to Combine Videos
- Build a library of personal components (publish your own workflows) and reuse them across projects

## Tips

- Click the refresh icon in the config panel to pull the latest published metadata and credit estimate.
- Input handles that are not wired can be filled inline (text type) or require a wire (image/video/audio type).
- The `pinnedVersion` is set when you add the node; it does not auto-upgrade. Use the refresh to move to the latest version intentionally.
- Outputs vary by component — inspect the **Outputs** section in the config panel to see handle names and types before wiring downstream nodes.
