---
"@nodaro/sdk": minor
---

`media.addCaptions` takes `transcribeProvider: "nemotron-3-5-transcribe"` (NVIDIA Nemotron 3.5 Transcribe, always with word timings). A render that transcribes on it is one charge, the render plus the video's started minutes: the video (an https link to a public host, up to 60 minutes) is measured before anything is held, and the run is charged for the length the model decoded (up or down; a video whose length cannot be read holds 60 minutes). Anything but an https link to a public host, or a video over 60 minutes, is a `400` before anything is charged. Nemotron's own file-size limit does not apply to the video: only its audio track is sent for transcription.
