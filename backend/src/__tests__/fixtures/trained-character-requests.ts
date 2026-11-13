/**
 * A trained character's runs as the code made them BEFORE the trained-character
 * model became a model a restriction can name (recorded on the tree that change
 * was made on; never re-record it): every route and workflow case of
 * trained-character-requests-parity.test.ts, with the job, the credit ids and
 * the input Replicate received. The parity test holds today's runs to it.
 */
export const TRAINED_CHARACTER_REQUESTS_BEFORE_CATALOG_ENTRY = {
  "route": {
    "no ratio": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "prompt": "TOK_kira walking on a beach",
        "referenceImageUrls": [],
        "provider": "flux-lora-character",
        "model": "flux-lora-character",
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "inputData": {
        "prompt": "TOK_kira walking on a beach",
        "provider": "flux-lora-character",
        "_internalLora": {
          "characterId": "00000000-0000-4000-8000-0000000000bb"
        },
        "injectCharacterContext": false,
        "userPrompt": "TOK_kira walking on a beach",
        "type": "generate-image",
        "resolvedModel": "flux-lora-character"
      },
      "debit": "flux-lora-character",
      "check": "flux-lora-character",
      "runModel": "flux-lora-character",
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, TOK_kira walking on a beach",
          "aspect_ratio": "1:1",
          "lora_scale": 1,
          "num_inference_steps": 28
        }
      }
    },
    "a square ratio": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "prompt": "TOK_kira in a cafe",
        "referenceImageUrls": [],
        "provider": "flux-lora-character",
        "model": "flux-lora-character",
        "aspectRatio": "1:1",
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "inputData": {
        "prompt": "TOK_kira in a cafe",
        "provider": "flux-lora-character",
        "_internalLora": {
          "characterId": "00000000-0000-4000-8000-0000000000bb"
        },
        "aspectRatio": "1:1",
        "injectCharacterContext": false,
        "userPrompt": "TOK_kira in a cafe",
        "type": "generate-image",
        "resolvedModel": "flux-lora-character"
      },
      "debit": "flux-lora-character",
      "check": "flux-lora-character",
      "runModel": "flux-lora-character",
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, TOK_kira in a cafe",
          "aspect_ratio": "1:1",
          "lora_scale": 1,
          "num_inference_steps": 28
        }
      }
    },
    "a wide ratio and a size": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "prompt": "TOK_kira on a rooftop",
        "referenceImageUrls": [],
        "provider": "flux-lora-character",
        "model": "flux-lora-character",
        "aspectRatio": "16:9",
        "resolution": "2K",
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "inputData": {
        "prompt": "TOK_kira on a rooftop",
        "provider": "flux-lora-character",
        "_internalLora": {
          "characterId": "00000000-0000-4000-8000-0000000000bb"
        },
        "aspectRatio": "16:9",
        "resolution": "2K",
        "injectCharacterContext": false,
        "userPrompt": "TOK_kira on a rooftop",
        "type": "generate-image",
        "resolvedModel": "flux-lora-character"
      },
      "debit": "flux-lora-character",
      "check": "flux-lora-character",
      "runModel": "flux-lora-character",
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, TOK_kira on a rooftop",
          "aspect_ratio": "16:9",
          "lora_scale": 1,
          "num_inference_steps": 28
        }
      }
    },
    "auto": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "prompt": "TOK_kira reading",
        "referenceImageUrls": [],
        "provider": "flux-lora-character",
        "model": "flux-lora-character",
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "inputData": {
        "prompt": "TOK_kira reading",
        "provider": "flux-lora-character",
        "_internalLora": {
          "characterId": "00000000-0000-4000-8000-0000000000bb"
        },
        "injectCharacterContext": false,
        "userPrompt": "TOK_kira reading",
        "type": "generate-image",
        "resolvedModel": "flux-lora-character"
      },
      "debit": "flux-lora-character",
      "check": "flux-lora-character",
      "runModel": "flux-lora-character",
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, TOK_kira reading",
          "aspect_ratio": "1:1",
          "lora_scale": 1,
          "num_inference_steps": 28
        }
      }
    },
    "a seed and a negative prompt": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "prompt": "TOK_kira dancing",
        "referenceImageUrls": [],
        "provider": "flux-lora-character",
        "model": "flux-lora-character",
        "aspectRatio": "3:4",
        "negativePrompt": "blur",
        "seed": 7,
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "inputData": {
        "prompt": "TOK_kira dancing",
        "provider": "flux-lora-character",
        "_internalLora": {
          "characterId": "00000000-0000-4000-8000-0000000000bb"
        },
        "aspectRatio": "3:4",
        "negativePrompt": "blur",
        "seed": 7,
        "injectCharacterContext": false,
        "userPrompt": "TOK_kira dancing",
        "type": "generate-image",
        "resolvedModel": "flux-lora-character"
      },
      "debit": "flux-lora-character",
      "check": "flux-lora-character",
      "runModel": "flux-lora-character",
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, TOK_kira dancing",
          "aspect_ratio": "3:4",
          "lora_scale": 1,
          "num_inference_steps": 28,
          "seed": 7
        }
      }
    }
  },
  "workflow": {
    "GPT Image 2, no ratio": {
      "jobName": "generate-image",
      "modelIdentifier": "flux-lora-character",
      "payload": {
        "jobId": "job-1",
        "prompt": "Kira walking on a beach",
        "referenceImageUrls": [],
        "provider": "replicate",
        "model": "flux-lora-character",
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, Kira walking on a beach",
          "aspect_ratio": "1:1",
          "lora_scale": 1,
          "num_inference_steps": 28
        }
      }
    },
    "GPT Image 2, auto": {
      "jobName": "generate-image",
      "modelIdentifier": "flux-lora-character",
      "payload": {
        "jobId": "job-1",
        "prompt": "Kira walking on a beach",
        "referenceImageUrls": [],
        "provider": "replicate",
        "model": "flux-lora-character",
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, Kira walking on a beach",
          "aspect_ratio": "1:1",
          "lora_scale": 1,
          "num_inference_steps": 28
        }
      }
    },
    "Seedream 5 Pro, 16:9 and a quality": {
      "jobName": "generate-image",
      "modelIdentifier": "flux-lora-character",
      "payload": {
        "jobId": "job-1",
        "prompt": "Kira on a rooftop",
        "referenceImageUrls": [],
        "provider": "replicate",
        "model": "flux-lora-character",
        "aspectRatio": "16:9",
        "quality": "high",
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, Kira on a rooftop",
          "aspect_ratio": "16:9",
          "lora_scale": 1,
          "num_inference_steps": 28
        }
      }
    },
    "Nano Banana 2, 1:1": {
      "jobName": "generate-image",
      "modelIdentifier": "flux-lora-character",
      "payload": {
        "jobId": "job-1",
        "prompt": "Kira in a cafe",
        "referenceImageUrls": [],
        "provider": "replicate",
        "model": "flux-lora-character",
        "aspectRatio": "1:1",
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, Kira in a cafe",
          "aspect_ratio": "1:1",
          "lora_scale": 1,
          "num_inference_steps": 28
        }
      }
    },
    "the default model": {
      "jobName": "generate-image",
      "modelIdentifier": "flux-lora-character",
      "payload": {
        "jobId": "job-1",
        "prompt": "Kira reading",
        "referenceImageUrls": [],
        "provider": "replicate",
        "model": "flux-lora-character",
        "extraParams": {
          "lora_version": "owner/char-kira:abc123",
          "lora_trigger": "TOK_kira"
        },
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "abc123",
        "input": {
          "prompt": "TOK_kira, Kira reading",
          "aspect_ratio": "1:1",
          "lora_scale": 1,
          "num_inference_steps": 28
        }
      }
    }
  }
}
