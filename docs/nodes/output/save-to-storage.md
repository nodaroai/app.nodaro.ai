# Save to Storage
> Export the final asset to Cloudflare R2 cloud storage.

## Overview
The Save to Storage node persists the upstream media result to Cloudflare R2 cloud storage. It accepts any media type (image, video, audio) and saves it as an asset linked to the user's account. This is the primary way to keep generated content beyond the workflow session. Saved assets count toward the user's storage quota.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Filename | string | `""` | Custom filename for the saved asset. If empty, a default name is generated. |
| Format | enum | `"mp4"` | Output format for video. Options: `mp4`, `webm`, `mov`. |
| Quality | enum | `"standard"` | Output quality tier. Options: `draft`, `standard`, `high`, `4k`. |

## Inputs & Outputs

**Inputs:**
- `in` -- Any media type (image, video, audio) from an upstream node.

**Outputs:**
None. This is a terminal output node.

## Credit Cost
0 credits. Storage is free; usage counts against the account storage quota.

## Best Practices
- Use descriptive filenames to organize saved assets in your library.
- Choose the appropriate quality tier based on your needs -- `draft` for quick previews, `high` or `4k` for final deliverables.
- Monitor your storage usage in account settings; saved assets count toward your tier's storage limit.
- Place this node at the end of your workflow to ensure the final processed result is saved.

## Common Use Cases
- Persisting final rendered videos for later download or sharing.
- Saving intermediate assets (images, audio) for reuse in other workflows.
- Archiving generated content to the asset library.
- Creating downloadable deliverables from automated workflow executions.

## Tips
- Saved assets appear in the user's asset library and can be downloaded or referenced later.
- Storage limits vary by subscription tier. The `StorageExceededModal` will appear if you exceed your quota.
- This node is typically the last node in a pipeline, after rendering and any post-processing.
- For automated workflows (webhook/schedule triggers), this node ensures outputs are persisted even when no user is actively viewing the editor.
