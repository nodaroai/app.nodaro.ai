/**
 * FLUX Fill Pro's requests as the code made them BEFORE it had a model-catalog
 * entry (recorded on the tree the entry was added to; never re-record it):
 * every route and workflow case of flux-fill-requests-parity.test.ts, with the
 * job, the credit ids and the input Replicate received. The parity test holds
 * today's requests to it.
 */
export const FLUX_FILL_REQUESTS_BEFORE_CATALOG_ENTRY = {
  "route": {
    "masked edit, nothing else": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "debit": "flux-fill",
      "check": "flux-fill",
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "masked edit, a named ratio": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "aspectRatio": "16:9",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "debit": "flux-fill",
      "check": "flux-fill",
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "masked edit, auto": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "aspectRatio": "auto",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "debit": "flux-fill",
      "check": "flux-fill",
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "masked edit, a size and a quality": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "resolution": "2K",
        "quality": "high",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "debit": "flux-fill",
      "check": "flux-fill",
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "masked edit, seed and negative prompt": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "negativePrompt": "blur",
        "seed": 7,
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "debit": "flux-fill",
      "check": "flux-fill",
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png",
          "seed": 7
        }
      }
    },
    "masked edit with a reference image": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/src.png",
        "referenceImageUrls": [
          "https://cdn.example.com/ref.png"
        ],
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "debit": "flux-fill",
      "check": "flux-fill",
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "Expand: a larger canvas with a mask, a ratio and a size": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/expanded-canvas.png",
        "prompt": "continue the beach to the left and right",
        "provider": "flux-fill",
        "resolution": "4K",
        "aspectRatio": "21:9",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "debit": "flux-fill",
      "check": "flux-fill",
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "continue the beach to the left and right",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/expanded-canvas.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "no mask, a named ratio": {
      "status": 200,
      "response": {
        "jobId": "job-1"
      },
      "queued": {
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "aspectRatio": "1:1",
        "usageLogId": "usage-1"
      },
      "debit": "flux-fill",
      "check": "flux-fill",
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png"
        }
      }
    }
  },
  "workflow": {
    "Modify Image, mask wired, ratio unset": {
      "jobName": "image-to-image",
      "modelIdentifier": "flux-fill",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "aspectRatio": "auto",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "Modify Image, a ratio and a size": {
      "jobName": "image-to-image",
      "modelIdentifier": "flux-fill",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "aspectRatio": "16:9",
        "resolution": "2K",
        "quality": "high",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "Modify Image, Expand: a larger canvas with a mask": {
      "jobName": "image-to-image",
      "modelIdentifier": "flux-fill",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/expanded-canvas.png",
        "prompt": "continue the beach",
        "provider": "flux-fill",
        "aspectRatio": "21:9",
        "resolution": "4K",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "continue the beach",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/expanded-canvas.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "Modify Image as the Image Overlay's AI finish adds it": {
      "jobName": "image-to-image",
      "modelIdentifier": "flux-fill",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "Blend the newly placed elements into the scene so they look photographed in place.",
        "provider": "flux-fill",
        "aspectRatio": "auto",
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "Blend the newly placed elements into the scene so they look photographed in place.",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png"
        }
      }
    },
    "Image to Image, mask on the node": {
      "jobName": "image-to-image",
      "modelIdentifier": "flux-fill",
      "payload": {
        "jobId": "job-1",
        "imageUrl": "https://cdn.example.com/src.png",
        "prompt": "a red scarf",
        "provider": "flux-fill",
        "aspectRatio": "4:3",
        "seed": 11,
        "maskUrl": "https://cdn.example.com/mask.png",
        "usageLogId": "usage-1"
      },
      "replicate": {
        "model": "black-forest-labs/flux-fill-pro",
        "input": {
          "prompt": "a red scarf",
          "output_format": "png",
          "safety_tolerance": 5,
          "image": "https://cdn.example.com/src.png",
          "mask": "https://cdn.example.com/mask.png",
          "seed": 11
        }
      }
    }
  }
} as const
