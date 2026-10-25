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

Open the home screen and pick **MCP Conversations** in the "Jump back in" row:

- **Month and year.** One month at a time. The arrows switch the year; the month menu
  marks the current month and shows how many conversations each month has (a past month with
  none cannot be picked). A conversation belongs to the month it started in.
- **Source.** Keep only some assistants: Claude, Claude Code, ChatGPT, Codex, Cursor and
  any other client you connected. Connections of one product are counted together
  ("Claude Code (nodaro)" and "Claude Code (staging)" are one Claude Code); hover a
  source to see them apart.
- **Each card:**
  - the assistant and when the conversation started;
  - its name, and how many nodes it has of each kind;
  - the credits it used;
  - a cover: one you set in the editor, or else its latest result;
  - a highlight while the conversation is still receiving steps.
- **The card menu:**
  - Open.
  - Export JSON (a template, as the editor exports it).
  - Copy to project…: a standalone copy in a project you pick. The conversation stays
    where it is, and the copy keeps each node's "Where it came from".
  - Rename.
  - Use the latest result as cover, when you set one.
  - Delete.

**Deleting a conversation** deletes its flow. The images and videos the assistant made stay in
your library and under **Recent from MCP**; results of runs you started in the editor are deleted
with the flow, as for any flow.

In the editor, a conversation's canvas says which assistant is building it and links
back to MCP Conversations. Each node an assistant made shows **Where it came from**
first in its settings: your request, the assistant, and under Details the tool it
called and when. Steps the assistant adds while you have the flow open appear on the
canvas by themselves; with unsaved edits, the editor tells you the flow changed
elsewhere instead of replacing your work.

Conversations are also listed programmatically:
- REST: `GET /v1/mcp-conversations?month=YYYY-MM&sources=claude,chatgpt`
- SDK: `client.workflows.listMcpConversations({ month, sources })`
- CLI: `nodaro workflows mcp-conversations --month YYYY-MM --source claude`

Each conversation is a workflow in your **mcp** project, filed under a hub workflow for
its month; the hubs do not appear in your workflow lists.

## Turning it off

Use the **Turn my conversations into flows** switch on the MCP Conversations tab. The
same setting is available through the API:

```http
PATCH /v1/user/settings
{ "mcpPreferences": { "flows": { "enabled": false } } }
```

With it off, MCP jobs run exactly as before and appear only in your library and under
**Recent from MCP**. Turn it back on (or send `true`) to resume.
