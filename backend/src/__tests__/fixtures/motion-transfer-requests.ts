/**
 * Motion Transfer's requests as the code made them BEFORE Wan Animate Move and
 * Replace had model-catalog entries (recorded on the tree the entries were
 * added to; never re-record it): every route and workflow case of
 * motion-transfer-requests-parity.test.ts, with the job, the credit ids and the
 * body KIE received. The parity test holds today's requests to it.
 */
export const MOTION_TRANSFER_REQUESTS_BEFORE_CATALOG_ENTRIES = {
  "route": {
    "kling @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "480p",
        "provider": "kling",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "480p",
        "provider": "kling",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "motion-transfer"
      },
      "debit": "motion-transfer:10s",
      "check": "motion-transfer:10s",
      "runModel": "motion-transfer",
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "480p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling @ 580p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "580p",
        "provider": "kling",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "580p",
        "provider": "kling",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "motion-transfer"
      },
      "debit": "motion-transfer:10s",
      "check": "motion-transfer:10s",
      "runModel": "motion-transfer",
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "580p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling @ 720p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "kling",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "kling",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "motion-transfer"
      },
      "debit": "motion-transfer:10s",
      "check": "motion-transfer:10s",
      "runModel": "motion-transfer",
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "1080p",
        "provider": "kling",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "1080p",
        "provider": "kling",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "motion-transfer"
      },
      "debit": "motion-transfer:1080p:10s",
      "check": "motion-transfer:1080p:10s",
      "runModel": "motion-transfer",
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "1080p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling @ (no size)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "kling",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "kling",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "motion-transfer"
      },
      "debit": "motion-transfer:10s",
      "check": "motion-transfer:10s",
      "runModel": "motion-transfer",
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "480p",
        "provider": "kling-3.0",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "480p",
        "provider": "kling-3.0",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "kling-3.0-motion"
      },
      "debit": "kling-3.0-motion:10s",
      "check": "kling-3.0-motion:10s",
      "runModel": "kling-3.0-motion",
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ 580p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "580p",
        "provider": "kling-3.0",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "580p",
        "provider": "kling-3.0",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "kling-3.0-motion"
      },
      "debit": "kling-3.0-motion:10s",
      "check": "kling-3.0-motion:10s",
      "runModel": "kling-3.0-motion",
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ 720p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "kling-3.0",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "kling-3.0",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "kling-3.0-motion"
      },
      "debit": "kling-3.0-motion:10s",
      "check": "kling-3.0-motion:10s",
      "runModel": "kling-3.0-motion",
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "1080p",
        "provider": "kling-3.0",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "1080p",
        "provider": "kling-3.0",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "kling-3.0-motion"
      },
      "debit": "kling-3.0-motion:1080p:10s",
      "check": "kling-3.0-motion:1080p:10s",
      "runModel": "kling-3.0-motion",
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "1080p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ (no size)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "kling-3.0",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "kling-3.0",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "kling-3.0-motion"
      },
      "debit": "kling-3.0-motion:10s",
      "check": "kling-3.0-motion:10s",
      "runModel": "kling-3.0-motion",
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "480p",
        "provider": "wan-animate-move",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "480p",
        "provider": "wan-animate-move",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-move"
      },
      "debit": "wan-animate-move",
      "check": "wan-animate-move",
      "runModel": "wan-animate-move",
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "480p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ 580p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "580p",
        "provider": "wan-animate-move",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "580p",
        "provider": "wan-animate-move",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-move"
      },
      "debit": "wan-animate-move:580p",
      "check": "wan-animate-move:580p",
      "runModel": "wan-animate-move",
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "580p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ 720p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "wan-animate-move",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "wan-animate-move",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-move"
      },
      "debit": "wan-animate-move:720p",
      "check": "wan-animate-move:720p",
      "runModel": "wan-animate-move",
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "1080p",
        "provider": "wan-animate-move",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "1080p",
        "provider": "wan-animate-move",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-move"
      },
      "debit": "wan-animate-move",
      "check": "wan-animate-move",
      "runModel": "wan-animate-move",
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "1080p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ (no size)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "wan-animate-move",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "wan-animate-move",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-move"
      },
      "debit": "wan-animate-move:720p",
      "check": "wan-animate-move:720p",
      "runModel": "wan-animate-move",
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ 480p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "480p",
        "provider": "wan-animate-replace",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "480p",
        "provider": "wan-animate-replace",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-replace"
      },
      "debit": "wan-animate-replace",
      "check": "wan-animate-replace",
      "runModel": "wan-animate-replace",
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "480p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ 580p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "580p",
        "provider": "wan-animate-replace",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "580p",
        "provider": "wan-animate-replace",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-replace"
      },
      "debit": "wan-animate-replace:580p",
      "check": "wan-animate-replace:580p",
      "runModel": "wan-animate-replace",
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "580p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ 720p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "wan-animate-replace",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "wan-animate-replace",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-replace"
      },
      "debit": "wan-animate-replace:720p",
      "check": "wan-animate-replace:720p",
      "runModel": "wan-animate-replace",
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ 1080p": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "1080p",
        "provider": "wan-animate-replace",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "1080p",
        "provider": "wan-animate-replace",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-replace"
      },
      "debit": "wan-animate-replace",
      "check": "wan-animate-replace",
      "runModel": "wan-animate-replace",
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "1080p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ (no size)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "wan-animate-replace",
        "usageLogId": "usage-1"
      },
      "inputData": {
        "imageUrl": "https://cdn.example.com/character.png",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "prompt": "a person dancing",
        "characterOrientation": "image",
        "resolution": "720p",
        "provider": "wan-animate-replace",
        "userPrompt": "a person dancing",
        "type": "motion-transfer",
        "resolvedModel": "wan-animate-replace"
      },
      "debit": "wan-animate-replace:720p",
      "check": "wan-animate-replace:720p",
      "runModel": "wan-animate-replace",
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "720p",
          "prompt": "a person dancing"
        }
      }
    }
  },
  "workflow": {
    "kling @ 480p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "motion-transfer:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "480p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling @ 580p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "motion-transfer:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling",
        "resolution": "580p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "580p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling @ 720p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "motion-transfer:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling",
        "resolution": "720p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling @ 1080p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "motion-transfer:1080p:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "1080p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling @ (no size)": {
      "jobName": "motion-transfer",
      "modelIdentifier": "motion-transfer:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling",
        "resolution": "720p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-2.6/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ 480p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "kling-3.0-motion:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling-3.0",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ 580p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "kling-3.0-motion:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling-3.0",
        "resolution": "580p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ 720p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "kling-3.0-motion:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling-3.0",
        "resolution": "720p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ 1080p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "kling-3.0-motion:1080p:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling-3.0",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "1080p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "kling-3.0 @ (no size)": {
      "jobName": "motion-transfer",
      "modelIdentifier": "kling-3.0-motion:10s",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "kling-3.0",
        "resolution": "720p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "kling-3.0/motion-control",
        "input": {
          "input_urls": [
            "https://cdn.example.com/character.png"
          ],
          "video_urls": [
            "https://cdn.example.com/dance.mp4"
          ],
          "character_orientation": "image",
          "mode": "720p",
          "background_source": "input_video",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ 480p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-move",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-move",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "480p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ 580p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-move:580p",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-move",
        "resolution": "580p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "580p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ 720p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-move:720p",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-move",
        "resolution": "720p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ 1080p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-move",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-move",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "1080p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-move @ (no size)": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-move:720p",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-move",
        "resolution": "720p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-move",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ 480p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-replace",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-replace",
        "resolution": "480p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "480p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ 580p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-replace:580p",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-replace",
        "resolution": "580p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "580p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ 720p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-replace:720p",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-replace",
        "resolution": "720p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "720p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ 1080p": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-replace",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-replace",
        "resolution": "1080p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "1080p",
          "prompt": "a person dancing"
        }
      }
    },
    "wan-animate-replace @ (no size)": {
      "jobName": "motion-transfer",
      "modelIdentifier": "wan-animate-replace:720p",
      "payload": {
        "jobId": "job-1",
        "videoUrl": "https://cdn.example.com/dance.mp4",
        "imageUrl": "https://cdn.example.com/character.png",
        "prompt": "a person dancing",
        "provider": "wan-animate-replace",
        "resolution": "720p",
        "usageLogId": "usage-1"
      },
      "kie": {
        "model": "wan/2-2-animate-replace",
        "input": {
          "image_url": "https://cdn.example.com/character.png",
          "video_url": "https://cdn.example.com/dance.mp4",
          "resolution": "720p",
          "prompt": "a person dancing"
        }
      }
    }
  }
}
