---
node_type: telegram-account-send
generated_at: 2026-10-03T23:19:37.320Z
generated_from: 425b85552
---

# Telegram Reply

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `telegram-account-send`
**Category:** output
**Credit cost:** `10` at list price — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's charged figure.
**Inputs (target handles):** `in`
**Outputs (source handles):** (none)

**Required data fields:**
- `label: string`

**Optional data fields:**
- `sendAs?: string`
- `accountId?: string`
- `destination?: string`
- `connectionId?: string`
- `text?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`

**Default data:**
```json
{
  "label": "Telegram Reply",
  "sendAs": "account",
  "destination": "reply",
  "text": ""
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

At the end of a workflow that should answer its owner on Telegram: the idea inbox (a post shared to the Telegram Account Trigger, analysed, answered under that post), or a scheduled digest sent to the owner's Saved Messages or bot. It sends only to the workflow's owner; to post to a channel or a group through a bot, use Telegram Post.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **There is no chat field.** `sendAs: "account"` writes as the connected account (`accountId`): `destination: "reply"` under the post that started the run, `"saved"` to Saved Messages. `sendAs: "bot"` writes from the owner's bot (`connectionId`, else their default bot) to the account's private chat with it.
- **`reply` needs a run started by the Telegram Account Trigger,** on a post the owner sent. In any other run (Run from here, a schedule, the API) it fails before sending: use `saved` or the bot there.
- **The owner must run it.** The account must be the runner's own, and the runner the workflow's owner; a shared or published run fails.
- **The bot cannot write first:** the owner opens the bot in Telegram and presses Start once.
- **One message per run.** Everything wired into `in` is joined into one message (a list is not sent once per item); a long message is split into up to 3 parts. 10 credits per run.
- **Runs on the server only.** In the editor it runs with Run from here.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "telegram-account-send-1",
  "type": "telegram-account-send",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Telegram Reply",
    "sendAs": "account",
    "destination": "reply",
    "text": ""
  }
}
```
<!-- AUTO-GEN:END examples -->
