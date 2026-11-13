/**
 * Lip Sync's requests as the code made them BEFORE LatentSync, HeyGen Lipsync
 * Precision and Lipsync 2 Pro had model-catalog entries (recorded on the tree
 * the entries were added to; never re-record it): every route and workflow case
 * of lip-sync-requests-parity.test.ts, with the job, the credit ids, the model
 * each run is judged on and what the provider received. The parity test holds
 * today's requests to it.
 */
export const LIP_SYNC_REQUESTS_BEFORE_CATALOG_ENTRIES = {
  "route": {
    "(no provider)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar:300s",
      "runModel": "kling-avatar",
      "debit": "kling-avatar:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar:300s",
      "runModel": "kling-avatar",
      "debit": "kling-avatar:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar:60s",
      "runModel": "kling-avatar",
      "debit": "kling-avatar:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          "1080p",
          42,
          {
            "fastMode": true,
            "seed": 7
          }
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar @ 7s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar:15s",
      "runModel": "kling-avatar",
      "debit": "kling-avatar:15s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "audioDurationSec": 7,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          7,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar @ 42s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar:60s",
      "runModel": "kling-avatar",
      "debit": "kling-avatar:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "audioDurationSec": 42,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          42,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar @ 400s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar:300s",
      "runModel": "kling-avatar",
      "debit": "kling-avatar:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "audioDurationSec": 400,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          400,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar-pro:300s",
      "runModel": "kling-avatar-pro",
      "debit": "kling-avatar-pro:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar-pro"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar-pro:60s",
      "runModel": "kling-avatar-pro",
      "debit": "kling-avatar-pro:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar-pro"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          "1080p",
          42,
          {
            "fastMode": true,
            "seed": 7
          }
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro @ 7s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar-pro:15s",
      "runModel": "kling-avatar-pro",
      "debit": "kling-avatar-pro:15s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "audioDurationSec": 7,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar-pro"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          null,
          7,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro @ 42s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar-pro:60s",
      "runModel": "kling-avatar-pro",
      "debit": "kling-avatar-pro:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "audioDurationSec": 42,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar-pro"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          null,
          42,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro @ 400s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "kling-avatar-pro:300s",
      "runModel": "kling-avatar-pro",
      "debit": "kling-avatar-pro:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "audioDurationSec": 400,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "kling-avatar-pro"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          null,
          400,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "infinitalk:720p",
      "runModel": "infinitalk",
      "debit": "infinitalk:720p",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "infinitalk"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "infinitalk:1080p",
      "runModel": "infinitalk",
      "debit": "infinitalk:1080p",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "infinitalk"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          "1080p",
          42,
          {
            "fastMode": true,
            "seed": 7
          }
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "infinitalk:480p",
      "runModel": "infinitalk",
      "debit": "infinitalk:480p",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "480p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "infinitalk"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          "480p",
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "infinitalk:1080p",
      "runModel": "infinitalk",
      "debit": "infinitalk:1080p",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "1080p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "infinitalk"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          "1080p",
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk @ 4k": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "infinitalk:4k",
      "runModel": "infinitalk",
      "debit": "infinitalk:4k",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "4k",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "infinitalk"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          "4k",
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "omnihuman-1-5:60s",
      "runModel": "omnihuman-1-5",
      "debit": "omnihuman-1-5:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "omnihuman-1-5"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5 + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "omnihuman-1-5:60s",
      "runModel": "omnihuman-1-5",
      "debit": "omnihuman-1-5:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "omnihuman-1-5"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          "1080p",
          42,
          {
            "fastMode": true,
            "seed": 7
          }
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5 @ 7s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "omnihuman-1-5:15s",
      "runModel": "omnihuman-1-5",
      "debit": "omnihuman-1-5:15s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "audioDurationSec": 7,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "omnihuman-1-5"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          null,
          7,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5 @ 42s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "omnihuman-1-5:60s",
      "runModel": "omnihuman-1-5",
      "debit": "omnihuman-1-5:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "audioDurationSec": 42,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "omnihuman-1-5"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          null,
          42,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5 @ 400s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "omnihuman-1-5:60s",
      "runModel": "omnihuman-1-5",
      "debit": "omnihuman-1-5:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "audioDurationSec": 400,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "omnihuman-1-5"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          null,
          400,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "latentsync": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "latentsync",
      "runModel": "latentsync",
      "debit": "latentsync",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "latentsync",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "latentsync",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "latentsync"
      },
      "sent": {
        "via": "replicate",
        "version": "637ce1919f807ca20da3a448ddc2743535d2853649574cd52a933120e9b9e293",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "latentsync"
      },
      "kind": "replicate-prediction"
    },
    "latentsync + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "latentsync",
      "runModel": "latentsync",
      "debit": "latentsync",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "latentsync",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "latentsync",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "latentsync"
      },
      "sent": {
        "via": "replicate",
        "version": "637ce1919f807ca20da3a448ddc2743535d2853649574cd52a933120e9b9e293",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3",
          "guidance_scale": 2,
          "inference_steps": 30,
          "seed": 7
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "latentsync"
      },
      "kind": "replicate-prediction"
    },
    "wav2lip": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "wav2lip",
      "runModel": "wav2lip",
      "debit": "wav2lip",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "wav2lip",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "wav2lip",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "wav2lip"
      },
      "sent": {
        "via": "replicate",
        "version": "8d65e3f4f4298520e079198b493c25adfc43c058ffec924f2aefc8010ed25eef",
        "input": {
          "face": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "wav2lip"
      },
      "kind": "replicate-prediction"
    },
    "wav2lip + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "wav2lip",
      "runModel": "wav2lip",
      "debit": "wav2lip",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "wav2lip",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "wav2lip",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "wav2lip"
      },
      "sent": {
        "via": "replicate",
        "version": "8d65e3f4f4298520e079198b493c25adfc43c058ffec924f2aefc8010ed25eef",
        "input": {
          "face": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3",
          "pads": "0 10 0 0",
          "smooth": true,
          "fps": 25,
          "resize_factor": 2
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "wav2lip"
      },
      "kind": "replicate-prediction"
    },
    "video-retalking": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "video-retalking",
      "runModel": "video-retalking",
      "debit": "video-retalking",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "video-retalking",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "video-retalking",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "video-retalking"
      },
      "sent": {
        "via": "replicate",
        "version": "db5a650c807b007dc5f9e5abe27c53e1b62880d1f94d218d27ce7fa802711d67",
        "input": {
          "face": "https://cdn.example.com/face.mp4",
          "input_audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "video-retalking"
      },
      "kind": "replicate-prediction"
    },
    "video-retalking + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "video-retalking",
      "runModel": "video-retalking",
      "debit": "video-retalking",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "video-retalking",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "video-retalking",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "video-retalking"
      },
      "sent": {
        "via": "replicate",
        "version": "db5a650c807b007dc5f9e5abe27c53e1b62880d1f94d218d27ce7fa802711d67",
        "input": {
          "face": "https://cdn.example.com/face.mp4",
          "input_audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "video-retalking"
      },
      "kind": "replicate-prediction"
    },
    "sadtalker": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "sadtalker",
      "runModel": "sadtalker",
      "debit": "sadtalker",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sadtalker",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sadtalker",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "sadtalker"
      },
      "sent": {
        "via": "replicate",
        "version": "a519cc0cfebaaeade068b23899165a11ec76aaa1d2b313d40d214f204ec957a3",
        "input": {
          "source_image": "https://cdn.example.com/face.mp4",
          "driven_audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "sadtalker"
      },
      "kind": "replicate-prediction"
    },
    "sadtalker + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "sadtalker",
      "runModel": "sadtalker",
      "debit": "sadtalker",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sadtalker",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sadtalker",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "sadtalker"
      },
      "sent": {
        "via": "replicate",
        "version": "a519cc0cfebaaeade068b23899165a11ec76aaa1d2b313d40d214f204ec957a3",
        "input": {
          "source_image": "https://cdn.example.com/face.mp4",
          "driven_audio": "https://cdn.example.com/line.mp3",
          "enhancer": "gfpgan",
          "preprocess": "full",
          "still": true,
          "pose_style": 3,
          "expression_scale": 1.5
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "sadtalker"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "heygen-lipsync-precision:300s",
      "runModel": "heygen-lipsync-precision",
      "debit": "heygen-lipsync-precision:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "heygen-lipsync-precision"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "heygen-lipsync-precision:60s",
      "runModel": "heygen-lipsync-precision",
      "debit": "heygen-lipsync-precision:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "heygen-lipsync-precision"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3",
          "enable_dynamic_duration": true,
          "disable_music_track": true,
          "enable_speech_enhancement": true
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision @ 7s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "heygen-lipsync-precision:15s",
      "runModel": "heygen-lipsync-precision",
      "debit": "heygen-lipsync-precision:15s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "audioDurationSec": 7,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "heygen-lipsync-precision"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision @ 42s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "heygen-lipsync-precision:60s",
      "runModel": "heygen-lipsync-precision",
      "debit": "heygen-lipsync-precision:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "audioDurationSec": 42,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "heygen-lipsync-precision"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision @ 400s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "heygen-lipsync-precision:300s",
      "runModel": "heygen-lipsync-precision",
      "debit": "heygen-lipsync-precision:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "audioDurationSec": 400,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "heygen-lipsync-precision"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "lipsync-2-pro:300s",
      "runModel": "lipsync-2-pro",
      "debit": "lipsync-2-pro:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "lipsync-2-pro"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "lipsync-2-pro:60s",
      "runModel": "lipsync-2-pro",
      "debit": "lipsync-2-pro:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "lipsync-2-pro"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3",
          "sync_mode": "bounce",
          "temperature": 0.4,
          "active_speaker": true
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro @ 7s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "lipsync-2-pro:15s",
      "runModel": "lipsync-2-pro",
      "debit": "lipsync-2-pro:15s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "audioDurationSec": 7,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "lipsync-2-pro"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro @ 42s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "lipsync-2-pro:60s",
      "runModel": "lipsync-2-pro",
      "debit": "lipsync-2-pro:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "audioDurationSec": 42,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "lipsync-2-pro"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro @ 400s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "lipsync-2-pro:300s",
      "runModel": "lipsync-2-pro",
      "debit": "lipsync-2-pro:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "audioDurationSec": 400,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "lipsync-2-pro"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "sync-lipsync-v3": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "sync-lipsync-v3:300s",
      "runModel": "sync-lipsync-v3",
      "debit": "sync-lipsync-v3:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "sync-lipsync-v3"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {}
        ]
      },
      "kind": "fal-request"
    },
    "sync-lipsync-v3 + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "sync-lipsync-v3:60s",
      "runModel": "sync-lipsync-v3",
      "debit": "sync-lipsync-v3:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "sync-lipsync-v3"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {
            "syncMode": "bounce",
            "audioDurationSec": 42,
            "activeSpeaker": true
          }
        ]
      },
      "kind": "fal-request"
    },
    "sync-lipsync-v3 @ 7s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "sync-lipsync-v3:15s",
      "runModel": "sync-lipsync-v3",
      "debit": "sync-lipsync-v3:15s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "audioDurationSec": 7,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "sync-lipsync-v3"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {
            "audioDurationSec": 7
          }
        ]
      },
      "kind": "fal-request"
    },
    "sync-lipsync-v3 @ 42s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "sync-lipsync-v3:60s",
      "runModel": "sync-lipsync-v3",
      "debit": "sync-lipsync-v3:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "audioDurationSec": 42,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "sync-lipsync-v3"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {
            "audioDurationSec": 42
          }
        ]
      },
      "kind": "fal-request"
    },
    "sync-lipsync-v3 @ 400s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "sync-lipsync-v3:300s",
      "runModel": "sync-lipsync-v3",
      "debit": "sync-lipsync-v3:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "audioDurationSec": 400,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "sync-lipsync-v3"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {
            "audioDurationSec": 400
          }
        ]
      },
      "kind": "fal-request"
    },
    "volcengine-lipsync": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "volcengine-lipsync:300s",
      "runModel": "volcengine-lipsync",
      "debit": "volcengine-lipsync:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "volcengine-lipsync"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {},
          null
        ]
      },
      "kind": "kie-lip-sync"
    },
    "volcengine-lipsync + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "volcengine-lipsync:60s",
      "runModel": "volcengine-lipsync",
      "debit": "volcengine-lipsync:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "volcengine-lipsync"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {
            "mode": "basic",
            "separateVocal": true,
            "openScenedet": true,
            "alignAudio": true,
            "alignAudioReverse": false,
            "templStartSeconds": 3
          },
          42
        ]
      },
      "kind": "kie-lip-sync"
    },
    "volcengine-lipsync @ 7s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "volcengine-lipsync:15s",
      "runModel": "volcengine-lipsync",
      "debit": "volcengine-lipsync:15s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "audioDurationSec": 7,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "volcengine-lipsync"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {},
          7
        ]
      },
      "kind": "kie-lip-sync"
    },
    "volcengine-lipsync @ 42s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "volcengine-lipsync:60s",
      "runModel": "volcengine-lipsync",
      "debit": "volcengine-lipsync:60s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "audioDurationSec": 42,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "volcengine-lipsync"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {},
          42
        ]
      },
      "kind": "kie-lip-sync"
    },
    "volcengine-lipsync @ 400s": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "volcengine-lipsync:300s",
      "runModel": "volcengine-lipsync",
      "debit": "volcengine-lipsync:300s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "audioDurationSec": 400,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "volcengine-lipsync"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {},
          400
        ]
      },
      "kind": "kie-lip-sync"
    },
    "seedance-2": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2:8s:720p-ref",
      "runModel": "seedance-2",
      "debit": "seedance-2:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2 + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2:8s:1080p-ref",
      "runModel": "seedance-2",
      "debit": "seedance-2:8s:1080p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2 @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2:8s:480p-ref",
      "runModel": "seedance-2",
      "debit": "seedance-2:8s:480p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "480p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2 @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2:8s:1080p-ref",
      "runModel": "seedance-2",
      "debit": "seedance-2:8s:1080p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "1080p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2 @ 4k": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2:8s:4k-ref",
      "runModel": "seedance-2",
      "debit": "seedance-2:8s:4k-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "4k",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-fast:8s:720p-ref",
      "runModel": "seedance-2-fast",
      "debit": "seedance-2-fast:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-fast"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-fast:8s:720p-ref",
      "runModel": "seedance-2-fast",
      "debit": "seedance-2-fast:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-fast"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-fast:8s:480p-ref",
      "runModel": "seedance-2-fast",
      "debit": "seedance-2-fast:8s:480p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "480p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-fast"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-fast:8s:720p-ref",
      "runModel": "seedance-2-fast",
      "debit": "seedance-2-fast:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "1080p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-fast"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast @ 4k": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-fast:8s:720p-ref",
      "runModel": "seedance-2-fast",
      "debit": "seedance-2-fast:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "4k",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-fast"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-mini:8s:720p-ref",
      "runModel": "seedance-2-mini",
      "debit": "seedance-2-mini:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-mini"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-mini:8s:720p-ref",
      "runModel": "seedance-2-mini",
      "debit": "seedance-2-mini:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-mini"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-mini:8s:480p-ref",
      "runModel": "seedance-2-mini",
      "debit": "seedance-2-mini:8s:480p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "480p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-mini"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-mini:8s:720p-ref",
      "runModel": "seedance-2-mini",
      "debit": "seedance-2-mini:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "1080p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-mini"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini @ 4k": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-mini:8s:720p-ref",
      "runModel": "seedance-2-mini",
      "debit": "seedance-2-mini:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "4k",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-mini"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-5:8s:720p-ref",
      "runModel": "seedance-2-5",
      "debit": "seedance-2-5:8s:720p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-5"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5 + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-5:8s:1080p-ref",
      "runModel": "seedance-2-5",
      "debit": "seedance-2-5:8s:1080p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-5"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5 @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-5:8s:480p-ref",
      "runModel": "seedance-2-5",
      "debit": "seedance-2-5:8s:480p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "480p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-5"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5 @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-5:8s:1080p-ref",
      "runModel": "seedance-2-5",
      "debit": "seedance-2-5:8s:1080p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "1080p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-5"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5 @ 4k": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "seedance-2-5:8s:1080p-ref",
      "runModel": "seedance-2-5",
      "debit": "seedance-2-5:8s:1080p-ref",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "4k",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "seedance-2-5"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "minimax-h3:8s",
      "runModel": "minimax-h3",
      "debit": "minimax-h3:8s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "minimax-h3"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3 + every lever": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "minimax-h3:8s",
      "runModel": "minimax-h3",
      "debit": "minimax-h3:8s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "fastMode": true,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "minimax-h3"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3 @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "minimax-h3:8s",
      "runModel": "minimax-h3",
      "debit": "minimax-h3:8s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "480p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "minimax-h3"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3 @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "minimax-h3:8s",
      "runModel": "minimax-h3",
      "debit": "minimax-h3:8s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "1080p",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "minimax-h3"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3 @ 4k": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "minimax-h3:8s",
      "runModel": "minimax-h3",
      "debit": "minimax-h3:8s",
      "queued": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "4k",
        "userPrompt": "make them talk",
        "type": "lip-sync",
        "resolvedModel": "minimax-h3"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    }
  },
  "workflow": {
    "(no provider)": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          "1080p",
          42,
          {
            "seed": 7
          }
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar @ 7s": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar:15s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          7,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar @ 42s": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          42,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar @ 400s": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar:300s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar",
          "make them talk",
          null,
          400,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar-pro",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar-pro:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          "1080p",
          42,
          {
            "seed": 7
          }
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro @ 7s": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar-pro:15s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          null,
          7,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro @ 42s": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar-pro:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          null,
          42,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "kling-avatar-pro @ 400s": {
      "jobName": "lip-sync",
      "modelIdentifier": "kling-avatar-pro:300s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "kling-avatar-pro",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "kling-avatar-pro",
          "make them talk",
          null,
          400,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk": {
      "jobName": "lip-sync",
      "modelIdentifier": "infinitalk:720p",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "infinitalk:1080p",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          "1080p",
          42,
          {
            "seed": 7
          }
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk @ 480p": {
      "jobName": "lip-sync",
      "modelIdentifier": "infinitalk:480p",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          "480p",
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk @ 1080p": {
      "jobName": "lip-sync",
      "modelIdentifier": "infinitalk:1080p",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          "1080p",
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "infinitalk @ 4k": {
      "jobName": "lip-sync",
      "modelIdentifier": "infinitalk:4k",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "infinitalk",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "infinitalk",
          "make them talk",
          "4k",
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5": {
      "jobName": "lip-sync",
      "modelIdentifier": "omnihuman-1-5",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          null,
          null,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5 + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "omnihuman-1-5:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          "1080p",
          42,
          {
            "seed": 7
          }
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5 @ 7s": {
      "jobName": "lip-sync",
      "modelIdentifier": "omnihuman-1-5:15s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          null,
          7,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5 @ 42s": {
      "jobName": "lip-sync",
      "modelIdentifier": "omnihuman-1-5:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          null,
          42,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "omnihuman-1-5 @ 400s": {
      "jobName": "lip-sync",
      "modelIdentifier": "omnihuman-1-5:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "omnihuman-1-5",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSync",
        "args": [
          "https://cdn.example.com/face.png",
          "https://cdn.example.com/line.mp3",
          "omnihuman-1-5",
          "make them talk",
          null,
          400,
          {}
        ]
      },
      "kind": "kie-lip-sync"
    },
    "latentsync": {
      "jobName": "lip-sync",
      "modelIdentifier": "latentsync",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "latentsync",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "637ce1919f807ca20da3a448ddc2743535d2853649574cd52a933120e9b9e293",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "latentsync"
      },
      "kind": "replicate-prediction"
    },
    "latentsync + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "latentsync",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "latentsync",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "637ce1919f807ca20da3a448ddc2743535d2853649574cd52a933120e9b9e293",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3",
          "guidance_scale": 2,
          "inference_steps": 30,
          "seed": 7
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "latentsync"
      },
      "kind": "replicate-prediction"
    },
    "wav2lip": {
      "jobName": "lip-sync",
      "modelIdentifier": "wav2lip",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "wav2lip",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "8d65e3f4f4298520e079198b493c25adfc43c058ffec924f2aefc8010ed25eef",
        "input": {
          "face": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "wav2lip"
      },
      "kind": "replicate-prediction"
    },
    "wav2lip + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "wav2lip",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "wav2lip",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "8d65e3f4f4298520e079198b493c25adfc43c058ffec924f2aefc8010ed25eef",
        "input": {
          "face": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3",
          "pads": "0 10 0 0",
          "smooth": true,
          "fps": 25,
          "resize_factor": 2
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "wav2lip"
      },
      "kind": "replicate-prediction"
    },
    "video-retalking": {
      "jobName": "lip-sync",
      "modelIdentifier": "video-retalking",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "video-retalking",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "db5a650c807b007dc5f9e5abe27c53e1b62880d1f94d218d27ce7fa802711d67",
        "input": {
          "face": "https://cdn.example.com/face.mp4",
          "input_audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "video-retalking"
      },
      "kind": "replicate-prediction"
    },
    "video-retalking + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "video-retalking",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "video-retalking",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "db5a650c807b007dc5f9e5abe27c53e1b62880d1f94d218d27ce7fa802711d67",
        "input": {
          "face": "https://cdn.example.com/face.mp4",
          "input_audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "video-retalking"
      },
      "kind": "replicate-prediction"
    },
    "sadtalker": {
      "jobName": "lip-sync",
      "modelIdentifier": "sadtalker",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sadtalker",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "a519cc0cfebaaeade068b23899165a11ec76aaa1d2b313d40d214f204ec957a3",
        "input": {
          "source_image": "https://cdn.example.com/face.mp4",
          "driven_audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "sadtalker"
      },
      "kind": "replicate-prediction"
    },
    "sadtalker + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "sadtalker",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sadtalker",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "a519cc0cfebaaeade068b23899165a11ec76aaa1d2b313d40d214f204ec957a3",
        "input": {
          "source_image": "https://cdn.example.com/face.mp4",
          "driven_audio": "https://cdn.example.com/line.mp3",
          "enhancer": "gfpgan",
          "preprocess": "full",
          "still": true,
          "pose_style": 3,
          "expression_scale": 1.5
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "sadtalker"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision": {
      "jobName": "lip-sync",
      "modelIdentifier": "heygen-lipsync-precision",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "heygen-lipsync-precision:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3",
          "enable_dynamic_duration": true,
          "disable_music_track": true,
          "enable_speech_enhancement": true
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision @ 7s": {
      "jobName": "lip-sync",
      "modelIdentifier": "heygen-lipsync-precision:15s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision @ 42s": {
      "jobName": "lip-sync",
      "modelIdentifier": "heygen-lipsync-precision:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "heygen-lipsync-precision @ 400s": {
      "jobName": "lip-sync",
      "modelIdentifier": "heygen-lipsync-precision:300s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "heygen-lipsync-precision",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "03d0f07dd626f1ef31febe77bcd36109359811887a9e358803747a9da2707d28",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "heygen-lipsync-precision"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro": {
      "jobName": "lip-sync",
      "modelIdentifier": "lipsync-2-pro",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "lipsync-2-pro:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3",
          "sync_mode": "bounce",
          "temperature": 0.4,
          "active_speaker": true
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro @ 7s": {
      "jobName": "lip-sync",
      "modelIdentifier": "lipsync-2-pro:15s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro @ 42s": {
      "jobName": "lip-sync",
      "modelIdentifier": "lipsync-2-pro:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "lipsync-2-pro @ 400s": {
      "jobName": "lip-sync",
      "modelIdentifier": "lipsync-2-pro:300s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "lipsync-2-pro",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "replicate",
        "version": "11f76931a8a9dbaea7958865fced66b2ee03ec0fda2928dbc7cb432c7bb48c6c",
        "input": {
          "video": "https://cdn.example.com/face.mp4",
          "audio": "https://cdn.example.com/line.mp3"
        },
        "label": "[replicate:lipSync]",
        "costModelKey": "lipsync-2-pro"
      },
      "kind": "replicate-prediction"
    },
    "sync-lipsync-v3": {
      "jobName": "lip-sync",
      "modelIdentifier": "sync-lipsync-v3",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {}
        ]
      },
      "kind": "fal-request"
    },
    "sync-lipsync-v3 + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "sync-lipsync-v3:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {
            "syncMode": "bounce",
            "audioDurationSec": 42,
            "activeSpeaker": true
          }
        ]
      },
      "kind": "fal-request"
    },
    "sync-lipsync-v3 @ 7s": {
      "jobName": "lip-sync",
      "modelIdentifier": "sync-lipsync-v3:15s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {
            "audioDurationSec": 7
          }
        ]
      },
      "kind": "fal-request"
    },
    "sync-lipsync-v3 @ 42s": {
      "jobName": "lip-sync",
      "modelIdentifier": "sync-lipsync-v3:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {
            "audioDurationSec": 42
          }
        ]
      },
      "kind": "fal-request"
    },
    "sync-lipsync-v3 @ 400s": {
      "jobName": "lip-sync",
      "modelIdentifier": "sync-lipsync-v3:300s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "sync-lipsync-v3",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "falLipSync",
        "args": [
          "sync-lipsync-v3",
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          {
            "audioDurationSec": 400
          }
        ]
      },
      "kind": "fal-request"
    },
    "volcengine-lipsync": {
      "jobName": "lip-sync",
      "modelIdentifier": "volcengine-lipsync",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {},
          null
        ]
      },
      "kind": "kie-lip-sync"
    },
    "volcengine-lipsync + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "volcengine-lipsync:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {
            "mode": "basic",
            "separateVocal": true,
            "openScenedet": true,
            "alignAudio": true,
            "alignAudioReverse": false,
            "templStartSeconds": 3
          },
          42
        ]
      },
      "kind": "kie-lip-sync"
    },
    "volcengine-lipsync @ 7s": {
      "jobName": "lip-sync",
      "modelIdentifier": "volcengine-lipsync:15s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "audioDurationSec": 7,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {},
          7
        ]
      },
      "kind": "kie-lip-sync"
    },
    "volcengine-lipsync @ 42s": {
      "jobName": "lip-sync",
      "modelIdentifier": "volcengine-lipsync:60s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "audioDurationSec": 42,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {},
          42
        ]
      },
      "kind": "kie-lip-sync"
    },
    "volcengine-lipsync @ 400s": {
      "jobName": "lip-sync",
      "modelIdentifier": "volcengine-lipsync:300s",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "volcengine-lipsync",
        "audioDurationSec": 400,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "lipSyncVideo",
        "args": [
          "https://cdn.example.com/face.mp4",
          "https://cdn.example.com/line.mp3",
          "volcengine-lipsync",
          {},
          400
        ]
      },
      "kind": "kie-lip-sync"
    },
    "seedance-2": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2 + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2 @ 480p": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2 @ 1080p": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2 @ 4k": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-fast",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-fast",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast @ 480p": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-fast",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast @ 1080p": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-fast",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-fast @ 4k": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-fast",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-fast",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-fast",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-mini",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-mini",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini @ 480p": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-mini",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini @ 1080p": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-mini",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-mini @ 4k": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-mini",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-mini",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-mini",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-5",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5 + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-5",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5 @ 480p": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-5",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5 @ 1080p": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-5",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "seedance-2-5 @ 4k": {
      "jobName": "lip-sync",
      "modelIdentifier": "seedance-2-5",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "seedance-2-5",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "seedance-2-5",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3": {
      "jobName": "lip-sync",
      "modelIdentifier": "minimax-h3",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "720p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3 + every lever": {
      "jobName": "lip-sync",
      "modelIdentifier": "minimax-h3",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "1080p",
        "audioDurationSec": 42,
        "guidanceScale": 2,
        "inferenceSteps": 30,
        "seed": 7,
        "pads": "0 10 0 0",
        "smooth": true,
        "fps": 25,
        "resizeFactor": 2,
        "enhancer": "gfpgan",
        "preprocess": "full",
        "still": true,
        "poseStyle": 3,
        "expressionScale": 1.5,
        "enableDynamicDuration": true,
        "disableMusicTrack": true,
        "enableSpeechEnhancement": true,
        "syncMode": "bounce",
        "temperature": 0.4,
        "activeSpeaker": true,
        "mode": "basic",
        "separateVocal": true,
        "openScenedet": true,
        "alignAudio": true,
        "alignAudioReverse": false,
        "templStartSeconds": 3,
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3 @ 480p": {
      "jobName": "lip-sync",
      "modelIdentifier": "minimax-h3",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "480p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3 @ 1080p": {
      "jobName": "lip-sync",
      "modelIdentifier": "minimax-h3",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "1080p",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    },
    "minimax-h3 @ 4k": {
      "jobName": "lip-sync",
      "modelIdentifier": "minimax-h3",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/face.png",
        "videoUrl": "https://cdn.example.com/face.mp4",
        "audioUrl": "https://cdn.example.com/line.mp3",
        "prompt": "make them talk",
        "provider": "minimax-h3",
        "resolution": "4k",
        "usageLogId": "usage-1"
      },
      "sent": {
        "via": "imageToVideo",
        "args": [
          "https://cdn.example.com/face.png",
          "minimax-h3",
          "make them talk",
          8,
          null,
          {
            "referenceAudioUrls": [
              "https://cdn.example.com/line.mp3"
            ],
            "resolution": "4k",
            "generateAudio": false
          }
        ]
      },
      "kind": "kie-standard"
    }
  }
}
