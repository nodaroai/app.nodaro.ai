# Manual Edit

> Open video in a browser-based web editor for manual adjustments.

## Overview

The Manual Edit node pauses workflow execution and opens the video in a web-based editor. Make manual adjustments (cuts, trims, overlays) in the browser, then confirm to continue the workflow. Useful when automated processing isn't sufficient and human judgment is needed.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Status | Display | — | Shows "Waiting for your edit" when paused |
| Input Video URL | Display | — | URL of the video being edited |

No configurable parameters — click "Open Editor" on the node during workflow execution.

## Inputs & Outputs

**Inputs:** Video (required)
**Outputs:** Edited video

## Credit Cost

0 credits — always free.

## Best Practices

- Place Manual Edit nodes at points where human review is essential
- Be aware that workflows with Manual Edit nodes cannot run fully autonomously
- Complete your edits promptly — the workflow pauses until you confirm

## Common Use Cases

- Fine-tune AI-generated video before final delivery
- Make precise cuts that automated trimming can't handle
- Add manual annotations or adjustments
- Review and approve content before social media publishing

## Tips

- Manual Edit breaks fully automated pipelines — use only when human input is genuinely needed
- For automated workflows triggered by webhooks or schedules, avoid this node
- The web editor opens in your browser — ensure you have a stable connection
