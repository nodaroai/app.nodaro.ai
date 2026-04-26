import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "실시간", description: "정상 재생 속도입니다" },
  "slow-motion": { label: "슬로우 모션", description: "적당히 느린 영상입니다" },
  "super-slow-mo": { label: "슈퍼 슬로우모", description: "극단적으로 느린 영상입니다" },
  "time-lapse": { label: "타임랩스", description: "시간이 압축되어 빠르게 흐릅니다" },
  "hyper-lapse": { label: "하이퍼랩스", description: "이동하는 타임랩스입니다" },
  "speed-ramp": { label: "스피드 램프", description: "샷 중간의 다이내믹한 속도 변화입니다" },

  // Freeze
  "full-freeze": { label: "풀 프리즈 프레임", description: "모든 동작이 정지됩니다" },
  "bullet-time": { label: "불릿 타임", description: "피사체는 정지하고 카메라가 회전합니다" },
  "frozen-subject": { label: "정지된 피사체", description: "피사체는 정지하고 세상은 움직입니다" },
  "moving-subject": { label: "움직이는 피사체", description: "피사체는 움직이고 세상은 정지됩니다" },

  // Direction
  "forward": { label: "정방향", description: "정상적인 정방향 재생입니다" },
  "reverse": { label: "역방향 / 되감기", description: "시간이 거꾸로 재생됩니다" },
  "loop-boomerang": { label: "루프 / 부메랑", description: "정방향 후 역방향 재생입니다" },

  // Shutter
  "long-exposure": { label: "장노출", description: "모션 트레일과 광선 흔적입니다" },
  "crisp-shutter": { label: "선명한 셔터", description: "블러 없는 또렷한 동작입니다" },
  "motion-blur": { label: "모션 블러", description: "두드러진 방향성 블러입니다" },
  "stutter-strobe": { label: "스터터 / 스트로브", description: "스트로브 효과의 끊기는 동작입니다" },
  "stop-motion": { label: "스톱 모션", description: "프레임 단위로 끊어지는 동작입니다" },
}

export default map
