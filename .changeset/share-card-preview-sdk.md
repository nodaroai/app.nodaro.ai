---
"@nodaro/sdk": minor
---

Share links preview better in chats and on social networks. `shares.set(...)` takes an optional `locale` (the interface language the link is shared in, e.g. `"de"`, `"pt-BR"`, `"he"`): the link's preview line is written in it. `Share` gains `locale` (or `null` for English). `SharedJob` gains `toolName` (what a person calls the tool that made it, e.g. `"Song Mashup"`) and `songTitle` (a song's own title, when it has one). All fields are additive.
