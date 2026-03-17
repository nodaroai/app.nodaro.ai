# Webhook Trigger

> Trigger workflow execution via HTTP webhook endpoint.

## Overview

The Webhook Trigger node creates a public HTTP endpoint that triggers workflow execution when called. Each trigger gets a unique token-based URL. Configure output parameters to pass data from the webhook request into the workflow. Useful for integrating with external systems, APIs, or automation tools like n8n and Zapier.

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
| Webhook URL | Full URL endpoint (auto-generated) |
| Token | 32-byte hex authentication token (masked) |

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
