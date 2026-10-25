# Your MCP conversations become flows

When you ask an assistant (Claude, ChatGPT, Claude Code and others) to make something
through the Nodaro MCP server, the work is not a black box. Each conversation becomes a
**flow** in your Nodaro account:

- every image or video the assistant generates is a **node**;
- when one result feeds the next (an image the assistant then animates), the two nodes
  are **connected**;
- you can open the flow in the editor, see exactly what was made and how, change a
  setting on one node and run just that node again.

The assistant also gets a link to the flow with every step, so it can send it to you
("open it in the editor: …").

## Which steps become nodes

Today these tools add a node to the conversation's flow:

| Tool | Node |
|---|---|
| `generate_image` | Generate Image |
| `modify_image`, `image_to_image` | Modify Image |
| `animate_image`, `generate_video` | Generate Video |

A call the node cannot reproduce exactly is not turned into a node: for example, several
images in one call (`count`, or more than one model at once), or a palette or moodboard
direction. Its result is still saved in your library and listed under **Recent from MCP**.
More tools are being added.

Images you pass in that the flow did not make (an upload, or an image from another
conversation) appear as an **Upload** node wired into the step that used them.

## One conversation, one flow

Nodaro keeps one flow per conversation:

- **ChatGPT** and **Claude Code** tell Nodaro which conversation a request belongs to, so
  each chat (for Claude Code, each launch) gets its own flow.
- **Claude** on the web and in the apps does not, so its steps join the same flow until
  there is a pause of more than **30 minutes**; the next step then starts a new flow. Two
  Claude chats running side by side within 30 minutes share one flow.

Each flow is named after your first request in the conversation (shortened to about 50
characters), or after the assistant's first prompt when the request is not available.

### Your own words

The tools above take an optional `user_request` argument: the assistant is asked to pass
your latest message, word for word. It is kept on the node ("Where it came from") and
names the flow. It never changes what is generated. Not every assistant passes it: an
assistant that keeps an old copy of Nodaro's tool list will not see the argument until
the connector refreshes it.

## Where the flows are

Conversation flows live in your **mcp** project, grouped by month: one item per month,
holding that month's conversations. A conversation belongs to the month it started in.

## Turning it off

The feature is on by default. To turn it off, save this setting (the in-app switch
arrives with the conversations screen):

```http
PATCH /v1/user/settings
{ "mcpPreferences": { "flows": { "enabled": false } } }
```

With it off, MCP jobs run exactly as before and appear only in your library and under
**Recent from MCP**. Send `true` to turn it back on.
