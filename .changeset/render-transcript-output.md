---
"@nodaro/shared": minor
---

A render's remapped transcript has a declared home: `RenderNodeDescriptor.transcriptOutput` (`{ handle, dataField }`) names the pip and saved node-data field it comes out on — Apply EDL's `json` / `generatedJson`, Speaker View's own `transcript` / `generatedTranscript`. Adds `RENDER_JSON_HANDLE`, `renderTranscriptOutputOf`, `isRenderDataHandle` and `renderSavedJsonOutputs`; `declaredJsonOutput` answers a render's transcript pip as a Transcript, the wordless-transcript preflight walks through it, and `generatedTranscript` is execution data (`EXECUTION_DATA_KEYS`).
