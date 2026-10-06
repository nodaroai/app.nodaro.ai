# Webhook Output
> Send workflow results to an external webhook URL.

## Overview
The Webhook Output node sends the upstream media result and any configured parameters to an external HTTP endpoint. This enables integration with third-party services, automation platforms, and custom backends by delivering workflow outputs via HTTP requests.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| URL | string | `""` | The destination webhook URL to receive the payload. |
| Params | WebhookParam[] | `[]` | List of parameters to include in the payload. Each parameter has a name and type. |
| Credential | string (id) | none | A stored HTTP credential to send with (`credentialId`). Saved once under **Integrations → Credentials**: a header name (for example `Authorization`) and its secret value. The node holds only the id — the secret never enters the workflow, an export, a template or a preset. |

### Sending once per item

Wired to a list on an **Each** wire (a Filter List of articles, a node that ran once per item), the node sends ONE request per item. A second list wired into another parameter pairs by row — item 3 goes out with item 3; a list shorter than the run starts over from its first item; an empty cell sends nothing for that parameter in that request.

When every wire into the node carried nothing in this run (a Filter List that kept no item, a source that was itself skipped), the node sends nothing and shows **Skipped · no input** — no empty request reaches your endpoint, and the run still ends `completed`.

### Sending with a credential

Many webhook targets accept a delivery only with a key in a header (Zapier and
Make private webhooks, Hookdeck, Segment, PostHog, a customer's own API, a bot
routine that expects `Authorization: Bearer …`). Save the key once as a
credential, pick it in the node, and every run attaches it — the value is
decrypted on the server at send time and is never shown again (rotating it is
saving a new value over the old one).

When you save a key, Integrations asks **who can use this key**, and the answer
is one of two:

- **Any address** (a **plain** credential) — no address attached. Works on runs
  you start yourself: a run from the editor, and a schedule you set up in the
  editor. It is refused on a published app, a shared workflow, a collaborator's
  run, a run started with an API token, a webhook trigger and a schedule created
  through the API, because the runner (or nobody) could otherwise aim it. The
  node fails with a clear message instead of sending. Best while you are still
  building.
- **Only one address** (a **locked** credential) — tied to an address, with an
  optional *Also allow paths under this address* for a whole service. Publishing
  an app or sharing a workflow for
  run requires every credential it sends with — sub-workflows included — to be
  locked first, to an address the node actually sends to; the publish / share
  dialog offers to lock a plain one to the node's current URL in one click,
  and explains a locked one whose address the node's URL is not under. By
  default the lock is the exact address (`https://` only — origin and path);
  optionally it covers everything under a path (`prefix`), so one key can serve
  several routines of the same service. Locking is one-way: the address can be
  changed but not removed — the dialog shows "Any address" greyed out, with the
  reason, on a key that already has one.

What the lock enforces at send time, on every hop:

- the node URL must match the locked address (exact, or under the prefix); the
  send is refused before the request leaves;
- a redirect to any other address is **not followed** — the request fails
  rather than continuing without the key;
- a plain credential is dropped by name on a cross-origin redirect;
- a credential is never sent over plain `http`.

With a credential attached the response body is **not** returned, stored or
shown — only the status code — because many targets reflect the request
headers back. A credential that was deleted or belongs to another account fails
the node with the same message; the node never sends without the key.

A stored credential is managed from the Nodaro app only (`403 in_app_only` for
API tokens and OAuth apps); runs that use one work from every lane. A workflow
export or template carries no `credentialId`: an imported node lands without
a credential and the importer picks their own.

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
