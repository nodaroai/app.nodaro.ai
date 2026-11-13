/**
 * Suno's requests as the code made them BEFORE Suno V4_5PLUS, V4_5ALL and V4_5
 * had model-catalog entries and price rows of their own (recorded on the tree
 * they were added to; never re-record it): every route and workflow case of
 * suno-requests-parity.test.ts, with the job, the credit ids and the price
 * charged for them, the model each run is judged on, and the Suno client call
 * the worker makes. The parity test holds today's requests to it.
 */
export const SUNO_REQUESTS_BEFORE_VERSION_ROWS = {
  "route": {
    "suno-generate @ (no version)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-v6",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V6",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V6",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V6",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6"
      }
    },
    "suno-generate @ V6": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-v6",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V6",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V6",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V6",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6"
      }
    },
    "suno-generate @ V6_WILD": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6_wild",
      "checkCharged": 33,
      "runModel": "suno-v6_wild",
      "debit": "suno-v6_wild",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V6_WILD",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V6_WILD",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "suno-v6_wild"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V6_WILD",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6_wild"
      }
    },
    "suno-generate @ V6_MINI": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6_mini",
      "checkCharged": 33,
      "runModel": "suno-v6_mini",
      "debit": "suno-v6_mini",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V6_MINI",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V6_MINI",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "suno-v6_mini"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V6_MINI",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6_mini"
      }
    },
    "suno-generate @ V5_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v5_5",
      "checkCharged": 33,
      "runModel": "suno-v5_5",
      "debit": "suno-v5_5",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V5_5",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V5_5",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "suno-v5_5"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V5_5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v5_5"
      }
    },
    "suno-generate @ V5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v5",
      "checkCharged": 33,
      "runModel": "suno-v5",
      "debit": "suno-v5",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V5",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V5",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "suno-v5"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v5"
      }
    },
    "suno-generate @ V4_5PLUS": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-generate",
      "checkCharged": 33,
      "runModel": "V4_5PLUS",
      "debit": "suno-generate",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V4_5PLUS",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V4_5PLUS",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "V4_5PLUS"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V4_5PLUS",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-generate"
      }
    },
    "suno-generate @ V4_5ALL": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-generate",
      "checkCharged": 33,
      "runModel": "V4_5ALL",
      "debit": "suno-generate",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V4_5ALL",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V4_5ALL",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "V4_5ALL"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V4_5ALL",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-generate"
      }
    },
    "suno-generate @ V4_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-generate",
      "checkCharged": 33,
      "runModel": "V4_5",
      "debit": "suno-generate",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V4_5",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V4_5",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "V4_5"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V4_5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-generate"
      }
    },
    "suno-generate @ V4": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-generate",
      "checkCharged": 33,
      "runModel": "suno",
      "debit": "suno-generate",
      "debitCharged": 33,
      "queued": {
        "name": "suno-generate",
        "data": {
          "prompt": "an upbeat song about the sea",
          "model": "V4",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "an upbeat song about the sea",
        "model": "V4",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "an upbeat song about the sea",
        "type": "suno-generate",
        "resolvedModel": "suno"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V4",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-generate"
      }
    },
    "suno-cover @ (no version)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-v6",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V6",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6"
      }
    },
    "suno-cover @ V6": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-v6",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V6",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6"
      }
    },
    "suno-cover @ V6_WILD": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6_wild",
      "checkCharged": 33,
      "runModel": "suno-v6_wild",
      "debit": "suno-v6_wild",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6_WILD",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V6_WILD",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "suno-v6_wild"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6_WILD",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6_wild"
      }
    },
    "suno-cover @ V6_MINI": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6_mini",
      "checkCharged": 33,
      "runModel": "suno-v6_mini",
      "debit": "suno-v6_mini",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6_MINI",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V6_MINI",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "suno-v6_mini"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6_MINI",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6_mini"
      }
    },
    "suno-cover @ V5_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v5_5",
      "checkCharged": 33,
      "runModel": "suno-v5_5",
      "debit": "suno-v5_5",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V5_5",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V5_5",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "suno-v5_5"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V5_5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v5_5"
      }
    },
    "suno-cover @ V5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v5",
      "checkCharged": 33,
      "runModel": "suno-v5",
      "debit": "suno-v5",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V5",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V5",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "suno-v5"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v5"
      }
    },
    "suno-cover @ V4_5PLUS": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-cover",
      "checkCharged": 33,
      "runModel": "V4_5PLUS",
      "debit": "suno-cover",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4_5PLUS",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V4_5PLUS",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "V4_5PLUS"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4_5PLUS",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-cover"
      }
    },
    "suno-cover @ V4_5ALL": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-cover",
      "checkCharged": 33,
      "runModel": "V4_5ALL",
      "debit": "suno-cover",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4_5ALL",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V4_5ALL",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "V4_5ALL"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4_5ALL",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-cover"
      }
    },
    "suno-cover @ V4_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-cover",
      "checkCharged": 33,
      "runModel": "V4_5",
      "debit": "suno-cover",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4_5",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V4_5",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "V4_5"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4_5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-cover"
      }
    },
    "suno-cover @ V4": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-cover",
      "checkCharged": 33,
      "runModel": "suno",
      "debit": "suno-cover",
      "debitCharged": 33,
      "queued": {
        "name": "suno-cover",
        "data": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4",
          "customMode": false,
          "instrumental": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V4",
        "customMode": false,
        "instrumental": false,
        "userPrompt": "a slow acoustic cover",
        "type": "suno-cover",
        "resolvedModel": "suno"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-cover"
      }
    },
    "suno-extend @ (no version)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-v6",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V6",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6",
          "continueAt": 30
        },
        "egressId": "suno-v6"
      }
    },
    "suno-extend @ V6": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-v6",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V6",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6",
          "continueAt": 30
        },
        "egressId": "suno-v6"
      }
    },
    "suno-extend @ V6_WILD": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6_wild",
      "checkCharged": 33,
      "runModel": "suno-v6_wild",
      "debit": "suno-v6_wild",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6_WILD",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V6_WILD",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "suno-v6_wild"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6_WILD",
          "continueAt": 30
        },
        "egressId": "suno-v6_wild"
      }
    },
    "suno-extend @ V6_MINI": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v6_mini",
      "checkCharged": 33,
      "runModel": "suno-v6_mini",
      "debit": "suno-v6_mini",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6_MINI",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V6_MINI",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "suno-v6_mini"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6_MINI",
          "continueAt": 30
        },
        "egressId": "suno-v6_mini"
      }
    },
    "suno-extend @ V5_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v5_5",
      "checkCharged": 33,
      "runModel": "suno-v5_5",
      "debit": "suno-v5_5",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V5_5",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V5_5",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "suno-v5_5"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V5_5",
          "continueAt": 30
        },
        "egressId": "suno-v5_5"
      }
    },
    "suno-extend @ V5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-v5",
      "checkCharged": 33,
      "runModel": "suno-v5",
      "debit": "suno-v5",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V5",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V5",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "suno-v5"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V5",
          "continueAt": 30
        },
        "egressId": "suno-v5"
      }
    },
    "suno-extend @ V4_5PLUS": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-extend",
      "checkCharged": 33,
      "runModel": "V4_5PLUS",
      "debit": "suno-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4_5PLUS",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V4_5PLUS",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "V4_5PLUS"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4_5PLUS",
          "continueAt": 30
        },
        "egressId": "suno-extend"
      }
    },
    "suno-extend @ V4_5ALL": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-extend",
      "checkCharged": 33,
      "runModel": "V4_5ALL",
      "debit": "suno-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4_5ALL",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V4_5ALL",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "V4_5ALL"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4_5ALL",
          "continueAt": 30
        },
        "egressId": "suno-extend"
      }
    },
    "suno-extend @ V4_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-extend",
      "checkCharged": 33,
      "runModel": "V4_5",
      "debit": "suno-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4_5",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V4_5",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "V4_5"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4_5",
          "continueAt": 30
        },
        "egressId": "suno-extend"
      }
    },
    "suno-extend @ V4": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-extend",
      "checkCharged": 33,
      "runModel": "suno",
      "debit": "suno-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-extend",
        "data": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4",
          "continueAt": 30,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V4",
        "continueAt": 30,
        "userPrompt": "keep going",
        "type": "suno-extend",
        "resolvedModel": "suno"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4",
          "continueAt": 30
        },
        "egressId": "suno-extend"
      }
    },
    "suno-mashup @ (no version)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V6",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V6": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V6",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V6_WILD": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "suno-v6_wild",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6_WILD",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V6_WILD",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "suno-v6_wild"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6_WILD",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V6_MINI": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "suno-v6_mini",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6_MINI",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V6_MINI",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "suno-v6_mini"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6_MINI",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V5_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "suno-v5_5",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V5_5",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V5_5",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "suno-v5_5"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V5_5",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "suno-v5",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V5",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V5",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "suno-v5"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V5",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V4_5PLUS": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "V4_5PLUS",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4_5PLUS",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V4_5PLUS",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "V4_5PLUS"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4_5PLUS",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V4_5ALL": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "V4_5ALL",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4_5ALL",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V4_5ALL",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "V4_5ALL"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4_5ALL",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V4_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "V4_5",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4_5",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V4_5",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "V4_5"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4_5",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V4": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-mashup",
      "checkCharged": 33,
      "runModel": "suno",
      "debit": "suno-mashup",
      "debitCharged": 33,
      "queued": {
        "name": "suno-mashup",
        "data": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4",
          "customMode": false,
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V4",
        "customMode": false,
        "type": "suno-mashup",
        "resolvedModel": "suno"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-upload-extend @ (no version)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V6",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V6",
        "type": "suno-upload-extend",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V6"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V6": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V6",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V6",
        "type": "suno-upload-extend",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V6"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V6_WILD": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "suno-v6_wild",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V6_WILD",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V6_WILD",
        "type": "suno-upload-extend",
        "resolvedModel": "suno-v6_wild"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V6_WILD"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V6_MINI": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "suno-v6_mini",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V6_MINI",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V6_MINI",
        "type": "suno-upload-extend",
        "resolvedModel": "suno-v6_mini"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V6_MINI"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V5_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "suno-v5_5",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V5_5",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V5_5",
        "type": "suno-upload-extend",
        "resolvedModel": "suno-v5_5"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V5_5"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "suno-v5",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V5",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V5",
        "type": "suno-upload-extend",
        "resolvedModel": "suno-v5"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V5"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V4_5PLUS": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "V4_5PLUS",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V4_5PLUS",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V4_5PLUS",
        "type": "suno-upload-extend",
        "resolvedModel": "V4_5PLUS"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V4_5PLUS"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V4_5ALL": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "V4_5ALL",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V4_5ALL",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V4_5ALL",
        "type": "suno-upload-extend",
        "resolvedModel": "V4_5ALL"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V4_5ALL"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V4_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "V4_5",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V4_5",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V4_5",
        "type": "suno-upload-extend",
        "resolvedModel": "V4_5"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V4_5"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V4": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-upload-extend",
      "checkCharged": 33,
      "runModel": "suno",
      "debit": "suno-upload-extend",
      "debitCharged": 33,
      "queued": {
        "name": "suno-upload-extend",
        "data": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V4",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": false,
        "instrumental": false,
        "model": "V4",
        "type": "suno-upload-extend",
        "resolvedModel": "suno"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": false,
          "instrumental": false,
          "model": "V4"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-add-instrumental @ (no version)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-add-instrumental",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-instrumental",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6",
        "type": "suno-add-instrumental",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V6": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-add-instrumental",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-instrumental",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6",
        "type": "suno-add-instrumental",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V6_WILD": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "suno-v6_wild",
      "debit": "suno-add-instrumental",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-instrumental",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_WILD",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6_WILD",
        "type": "suno-add-instrumental",
        "resolvedModel": "suno-v6_wild"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_WILD"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V6_MINI": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "suno-v6_mini",
      "debit": "suno-add-instrumental",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-instrumental",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_MINI",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6_MINI",
        "type": "suno-add-instrumental",
        "resolvedModel": "suno-v6_mini"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_MINI"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V5_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "suno-v5_5",
      "debit": "suno-add-instrumental",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-instrumental",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5_5",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V5_5",
        "type": "suno-add-instrumental",
        "resolvedModel": "suno-v5_5"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5_5"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "suno-v5",
      "debit": "suno-add-instrumental",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-instrumental",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V5",
        "type": "suno-add-instrumental",
        "resolvedModel": "suno-v5"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V4_5PLUS": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "V4_5PLUS",
      "debit": "suno-add-instrumental",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-instrumental",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5PLUS",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4_5PLUS",
        "type": "suno-add-instrumental",
        "resolvedModel": "V4_5PLUS"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5PLUS"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V4_5ALL": {
      "status": 400,
      "response": {
        "error": {
          "code": "validation_error",
          "message": "model: Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\"",
          "issues": [
            {
              "path": "model",
              "message": "Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\""
            }
          ]
        }
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "V4_5ALL"
    },
    "suno-add-instrumental @ V4_5": {
      "status": 400,
      "response": {
        "error": {
          "code": "validation_error",
          "message": "model: Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\"",
          "issues": [
            {
              "path": "model",
              "message": "Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\""
            }
          ]
        }
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "V4_5"
    },
    "suno-add-instrumental @ V4": {
      "status": 400,
      "response": {
        "error": {
          "code": "validation_error",
          "message": "model: Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\"",
          "issues": [
            {
              "path": "model",
              "message": "Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\""
            }
          ]
        }
      },
      "check": "suno-add-instrumental",
      "checkCharged": 33,
      "runModel": "suno"
    },
    "suno-add-vocals @ (no version)": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-add-vocals",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-vocals",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6",
        "type": "suno-add-vocals",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V6": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "suno-v6",
      "debit": "suno-add-vocals",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-vocals",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6",
        "type": "suno-add-vocals",
        "resolvedModel": "suno-v6"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V6_WILD": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "suno-v6_wild",
      "debit": "suno-add-vocals",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-vocals",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_WILD",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6_WILD",
        "type": "suno-add-vocals",
        "resolvedModel": "suno-v6_wild"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_WILD"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V6_MINI": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "suno-v6_mini",
      "debit": "suno-add-vocals",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-vocals",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_MINI",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6_MINI",
        "type": "suno-add-vocals",
        "resolvedModel": "suno-v6_mini"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_MINI"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V5_5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "suno-v5_5",
      "debit": "suno-add-vocals",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-vocals",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5_5",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V5_5",
        "type": "suno-add-vocals",
        "resolvedModel": "suno-v5_5"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5_5"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V5": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "suno-v5",
      "debit": "suno-add-vocals",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-vocals",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V5",
        "type": "suno-add-vocals",
        "resolvedModel": "suno-v5"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V4_5PLUS": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "V4_5PLUS",
      "debit": "suno-add-vocals",
      "debitCharged": 33,
      "queued": {
        "name": "suno-add-vocals",
        "data": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5PLUS",
          "usageLogId": "usage-1"
        }
      },
      "inputData": {
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4_5PLUS",
        "type": "suno-add-vocals",
        "resolvedModel": "V4_5PLUS"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5PLUS"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V4_5ALL": {
      "status": 400,
      "response": {
        "error": {
          "code": "validation_error",
          "message": "model: Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\"",
          "issues": [
            {
              "path": "model",
              "message": "Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\""
            }
          ]
        }
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "V4_5ALL"
    },
    "suno-add-vocals @ V4_5": {
      "status": 400,
      "response": {
        "error": {
          "code": "validation_error",
          "message": "model: Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\"",
          "issues": [
            {
              "path": "model",
              "message": "Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\""
            }
          ]
        }
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "V4_5"
    },
    "suno-add-vocals @ V4": {
      "status": 400,
      "response": {
        "error": {
          "code": "validation_error",
          "message": "model: Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\"",
          "issues": [
            {
              "path": "model",
              "message": "Invalid option: expected one of \"V6\"|\"V6_WILD\"|\"V6_MINI\"|\"V4_5PLUS\"|\"V5\"|\"V5_5\""
            }
          ]
        }
      },
      "check": "suno-add-vocals",
      "checkCharged": 33,
      "runModel": "suno"
    }
  },
  "workflow": {
    "suno-generate @ (no version)": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-generate",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-generate"
      }
    },
    "suno-generate @ V6": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-v6",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "model": "V6",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V6",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6"
      }
    },
    "suno-generate @ V6_WILD": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-v6_wild",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "model": "V6_WILD",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V6_WILD",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6_wild"
      }
    },
    "suno-generate @ V6_MINI": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-v6_mini",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "model": "V6_MINI",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V6_MINI",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6_mini"
      }
    },
    "suno-generate @ V5_5": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-v5_5",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "model": "V5_5",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V5_5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v5_5"
      }
    },
    "suno-generate @ V5": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-v5",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "model": "V5",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v5"
      }
    },
    "suno-generate @ V4_5PLUS": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-generate",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "model": "V4_5PLUS",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V4_5PLUS",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-generate"
      }
    },
    "suno-generate @ V4_5ALL": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-generate",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "model": "V4_5ALL",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V4_5ALL",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-generate"
      }
    },
    "suno-generate @ V4_5": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-generate",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "model": "V4_5",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V4_5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-generate"
      }
    },
    "suno-generate @ V4": {
      "jobName": "suno-generate",
      "modelIdentifier": "suno-generate",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "an upbeat song about the sea",
        "model": "V4",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoGenerate",
        "params": {
          "prompt": "an upbeat song about the sea",
          "model": "V4",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-generate"
      }
    },
    "suno-cover @ (no version)": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-cover",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-cover"
      }
    },
    "suno-cover @ V6": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-v6",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V6",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6"
      }
    },
    "suno-cover @ V6_WILD": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-v6_wild",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V6_WILD",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6_WILD",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6_wild"
      }
    },
    "suno-cover @ V6_MINI": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-v6_mini",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V6_MINI",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V6_MINI",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v6_mini"
      }
    },
    "suno-cover @ V5_5": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-v5_5",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V5_5",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V5_5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v5_5"
      }
    },
    "suno-cover @ V5": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-v5",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V5",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-v5"
      }
    },
    "suno-cover @ V4_5PLUS": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-cover",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V4_5PLUS",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4_5PLUS",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-cover"
      }
    },
    "suno-cover @ V4_5ALL": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-cover",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V4_5ALL",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4_5ALL",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-cover"
      }
    },
    "suno-cover @ V4_5": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-cover",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V4_5",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4_5",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-cover"
      }
    },
    "suno-cover @ V4": {
      "jobName": "suno-cover",
      "modelIdentifier": "suno-cover",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "prompt": "a slow acoustic cover",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "model": "V4",
        "customMode": false,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoCover",
        "params": {
          "prompt": "a slow acoustic cover",
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "model": "V4",
          "customMode": false,
          "instrumental": false
        },
        "egressId": "suno-cover"
      }
    },
    "suno-extend @ (no version)": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "continueAt": 30
        },
        "egressId": "suno-extend"
      }
    },
    "suno-extend @ V6": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-v6",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V6",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6",
          "continueAt": 30
        },
        "egressId": "suno-v6"
      }
    },
    "suno-extend @ V6_WILD": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-v6_wild",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V6_WILD",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6_WILD",
          "continueAt": 30
        },
        "egressId": "suno-v6_wild"
      }
    },
    "suno-extend @ V6_MINI": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-v6_mini",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V6_MINI",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V6_MINI",
          "continueAt": 30
        },
        "egressId": "suno-v6_mini"
      }
    },
    "suno-extend @ V5_5": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-v5_5",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V5_5",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V5_5",
          "continueAt": 30
        },
        "egressId": "suno-v5_5"
      }
    },
    "suno-extend @ V5": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-v5",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V5",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V5",
          "continueAt": 30
        },
        "egressId": "suno-v5"
      }
    },
    "suno-extend @ V4_5PLUS": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V4_5PLUS",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4_5PLUS",
          "continueAt": 30
        },
        "egressId": "suno-extend"
      }
    },
    "suno-extend @ V4_5ALL": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V4_5ALL",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4_5ALL",
          "continueAt": 30
        },
        "egressId": "suno-extend"
      }
    },
    "suno-extend @ V4_5": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V4_5",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4_5",
          "continueAt": 30
        },
        "egressId": "suno-extend"
      }
    },
    "suno-extend @ V4": {
      "jobName": "suno-extend",
      "modelIdentifier": "suno-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "audioId": "track-1",
        "defaultParamFlag": true,
        "prompt": "keep going",
        "model": "V4",
        "continueAt": 30,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoExtend",
        "params": {
          "audioId": "track-1",
          "defaultParamFlag": true,
          "prompt": "keep going",
          "model": "V4",
          "continueAt": 30
        },
        "egressId": "suno-extend"
      }
    },
    "suno-mashup @ (no version)": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V6": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V6",
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V6_WILD": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V6_WILD",
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6_WILD",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V6_MINI": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V6_MINI",
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V6_MINI",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V5_5": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V5_5",
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V5_5",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V5": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V5",
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V5",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V4_5PLUS": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V4_5PLUS",
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4_5PLUS",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V4_5ALL": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V4_5ALL",
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4_5ALL",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V4_5": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V4_5",
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4_5",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-mashup @ V4": {
      "jobName": "suno-mashup",
      "modelIdentifier": "suno-mashup",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrlList": [
          "https://cdn.example.com/track.mp3",
          "https://cdn.example.com/track-2.mp3"
        ],
        "model": "V4",
        "customMode": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoMashup",
        "params": {
          "uploadUrlList": [
            "https://cdn.example.com/track.mp3",
            "https://cdn.example.com/track-2.mp3"
          ],
          "model": "V4",
          "customMode": false
        },
        "egressId": "suno-mashup"
      }
    },
    "suno-upload-extend @ (no version)": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V6": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "model": "V6",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false,
          "model": "V6"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V6_WILD": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "model": "V6_WILD",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false,
          "model": "V6_WILD"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V6_MINI": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "model": "V6_MINI",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false,
          "model": "V6_MINI"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V5_5": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "model": "V5_5",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false,
          "model": "V5_5"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V5": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "model": "V5",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false,
          "model": "V5"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V4_5PLUS": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "model": "V4_5PLUS",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false,
          "model": "V4_5PLUS"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V4_5ALL": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "model": "V4_5ALL",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false,
          "model": "V4_5ALL"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V4_5": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "model": "V4_5",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false,
          "model": "V4_5"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-upload-extend @ V4": {
      "jobName": "suno-upload-extend",
      "modelIdentifier": "suno-upload-extend",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "uploadUrl": "https://cdn.example.com/track.mp3",
        "continueAt": 30,
        "defaultParamFlag": true,
        "instrumental": false,
        "model": "V4",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoUploadExtend",
        "params": {
          "uploadUrl": "https://cdn.example.com/track.mp3",
          "continueAt": 30,
          "defaultParamFlag": true,
          "instrumental": false,
          "model": "V4"
        },
        "egressId": "suno-upload-extend"
      }
    },
    "suno-add-instrumental @ (no version)": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V6": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V6_WILD": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6_WILD",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_WILD"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V6_MINI": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6_MINI",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_MINI"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V5_5": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V5_5",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5_5"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V5": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V5",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V4_5PLUS": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4_5PLUS",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5PLUS"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V4_5ALL": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4_5ALL",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5ALL"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V4_5": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4_5",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-instrumental @ V4": {
      "jobName": "suno-add-instrumental",
      "modelIdentifier": "suno-add-instrumental",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddInstrumental",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4"
        },
        "egressId": "suno-add-instrumental"
      }
    },
    "suno-add-vocals @ (no version)": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V6": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V6_WILD": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6_WILD",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_WILD"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V6_MINI": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V6_MINI",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V6_MINI"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V5_5": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V5_5",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5_5"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V5": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V5",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V5"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V4_5PLUS": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4_5PLUS",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5PLUS"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V4_5ALL": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4_5ALL",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5ALL"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V4_5": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4_5",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4_5"
        },
        "egressId": "suno-add-vocals"
      }
    },
    "suno-add-vocals @ V4": {
      "jobName": "suno-add-vocals",
      "modelIdentifier": "suno-add-vocals",
      "charged": 33,
      "payload": {
        "jobId": "job-1",
        "taskId": "task-1",
        "audioId": "track-1",
        "model": "V4",
        "usageLogId": "usage-1"
      },
      "client": {
        "fn": "sunoAddVocals",
        "params": {
          "taskId": "task-1",
          "audioId": "track-1",
          "model": "V4"
        },
        "egressId": "suno-add-vocals"
      }
    }
  }
}
