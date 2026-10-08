# Webhook Trigger

> Trigger workflow execution via HTTP webhook endpoint.

## Overview

The Webhook Trigger node creates a public HTTP endpoint that triggers workflow execution when called. Each trigger gets a unique token-based URL. Configure output parameters to pass data from the webhook request into the workflow. Useful for integrating with external systems, APIs, or automation tools like n8n and Zapier.

## What a triggered run executes

A trigger that is **wired to something** runs only the branch behind it — the nodes downstream of the trigger, plus every node those nodes need as input (so a branch that also reads from a node off to the side gets a fresh result). Nodes the trigger does not reach are left alone. A trigger **wired to nothing** runs the whole workflow. This is what lets one workflow carry several triggers, each starting its own branch. A manual run from the editor, an API run and a published app are not scoped by triggers.

"Wired" is anything that feeds another node: a drawn connection, a node inside a Group (it feeds the group), or a field mapping. The run starts from the node the webhook was saved from; a webhook created by hand through the API names no node, so the only Webhook Trigger on the canvas is used — with two such nodes there is no honest answer, and the whole workflow runs.

**A branch that stops for a review is refused.** When the branch a trigger runs holds an [Apply EDL](../processing-video/apply-edl.md) render set to **Preview**, nobody is there to review what it renders, so every fire is refused before anything runs or is billed: the webhook call answers `400` with the code `preview_review_required`. The workflow's run history shows one failed run with the code `preview_review_required` (repeated fires do not add more), and the trigger's card warns while it is switched on. Set the render's **Quality** to **Final** to let the trigger run. (Rolled out under a flag, `PREVIEW_STOP_RULE_ENABLED`; where it is off, nothing is refused. See [Apply EDL](../processing-video/apply-edl.md#a-run-stops-at-a-preview).)

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Output Parameters | Dynamic list | — | Define parameters to extract from webhook payload |

### Per Parameter

| Field | Type | Description |
|-------|------|-------------|
| Name | Text | Parameter name (matches JSON key in request body) |
| Type | Select | Data type: text, imageUrl, videoUrl, audioUrl |

### Generated Fields (Read-only)

| Field | Description |
|-------|-------------|
| Webhook URL | The full URL to POST to, with a copy button. It appears once the workflow has been saved with the node. |
| Token | 32-byte hex authentication token (masked), with a copy button |

On the canvas the node shows the URL with its token shortened, since the token is the endpoint's only credential. Copy the full URL from the settings panel.

## Activation

**Saving the workflow is what creates the endpoint.** Adding the node and
saving mints a 32-byte token and registers `POST /v1/webhooks/<token>`;
removing the node retires it. The token is minted once and then left alone, so
the URL you hand to an external system stays valid across every later save.

The editor shows the URL in the node's settings as soon as that save lands. Through the API, read the current URL and token with `GET /v1/workflows/<id>/triggers`; the row whose `config.nodeId` is the node's id is this node's trigger.

## Inputs & Outputs

**Inputs:** None (this is a trigger node)

**Outputs:**
- Configured parameters — extracted from the incoming webhook request body
## Rate Limiting

10 requests per minute per token.

## Best Practices

- Define clear parameter names that match your external system's payload structure
- Use appropriate types (imageUrl, videoUrl) so downstream nodes interpret the data correctly
- Keep webhook tokens secure — anyone with the token can trigger your workflow
- Test with a simple POST request before connecting to production systems

## Common Use Cases

- Trigger video generation from a CMS when new content is published
- Integrate with n8n/Zapier for multi-platform automation
- Accept image uploads from external apps for processing
- Build API-driven content pipelines

## Tips

- The webhook endpoint is public and requires no user authentication — only the token
- POST to the webhook URL with a JSON body containing your parameter values
- Parameter types help route data correctly: `imageUrl` values feed into image inputs, `videoUrl` into video inputs
- Combine with Schedule Trigger for time-based AND event-based workflow execution
