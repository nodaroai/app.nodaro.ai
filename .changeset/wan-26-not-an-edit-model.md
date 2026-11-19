---
"@nodaro/shared": minor
---

Wan 2.6 (`wan`) and Wan 2.6 Flash (`wan-flash`) are no longer listed as edit models. The catalog mode `v2v` lists the models that edit the clip they are given, and Wan 2.6 video-to-video makes a new clip featuring the input video's subject instead. `wan` now carries `modes: ["t2v"]` and `wan-flash` carries no mode, so neither is returned by `GET /v1/models?mode=v2v` or MCP `list_models` with `mode: "v2v"`, and a client that builds an "edit" list from that mode no longer offers them. `wan` keeps its text-to-video listing. Both remain Video to Video providers (`VIDEO_TO_VIDEO_PROVIDERS`): the node's menu still offers them and a request that names `provider: "wan"` or `"wan-flash"` runs as before, at the same price. The catalog label of `wan-flash` is now "Wan 2.6 Flash" (was "Wan Flash V2V"); its id is unchanged.
