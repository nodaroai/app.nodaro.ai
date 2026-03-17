# Webhook Output
> Send workflow results to an external webhook URL.

## Overview
The Webhook Output node sends the upstream media result and any configured parameters to an external HTTP endpoint. This enables integration with third-party services, automation platforms, and custom backends by delivering workflow outputs via HTTP requests.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| URL | string | `""` | The destination webhook URL to receive the payload. |
| Params | WebhookParam[] | `[]` | List of parameters to include in the payload. Each parameter has a name and type. |

### Webhook Parameter Types

| Type | Description |
|------|-------------|
| `text` | Plain text value. |
| `imageUrl` | URL to an image asset. |
| `videoUrl` | URL to a video asset. |
| `audioUrl` | URL to an audio asset. |

## Inputs & Outputs

**Inputs:**
- `in` -- Any media type or data from an upstream node.

**Outputs:**
None. This is a terminal output node.
## Best Practices
- Verify the webhook URL is reachable and accepts POST requests before running the workflow.
- Define parameter names and types that match what the receiving service expects.
- Use HTTPS URLs for secure data transmission.
- Test with a service like webhook.site or RequestBin during development.

## Common Use Cases
- Sending generated videos to a content management system.
- Triggering downstream automation in n8n, Zapier, or Make when content is ready.
- Delivering results to a custom backend API for further processing.
- Notifying external services that a workflow execution has completed.

## Tips
- The webhook receives a POST request with the configured parameters in the body.
- Media URLs point to R2-hosted assets and are accessible via HTTP.
- This node is often paired with webhook or schedule trigger nodes for fully automated pipelines.
- If the external endpoint returns an error, the node execution will fail and the error will be visible in the execution history.
