import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Aperture (technical units stay in alphanumeric)
  "aperture-f1-2": { description: "면도날처럼 얇은 DOF, 몽환적인 보케입니다" },
  "aperture-f1-4": { description: "공격적인 피사체 분리입니다" },
  "aperture-f1-8": { description: "클래식한 인물 분리입니다" },
  "aperture-f2-8": { description: "피사체는 또렷하고, 배경은 부드럽습니다" },
  "aperture-f4": { description: "균형 잡힌 일상적인 DOF입니다" },
  "aperture-f5-6": { description: "피사체 전반에 걸쳐 또렷합니다" },
  "aperture-f8": { description: "가장 선명한 스위트 스팟 샤프니스입니다" },
  "aperture-f11": { description: "깊은 풍경 사진용 DOF입니다" },
  "aperture-f16": { description: "초점 무한대, 햇빛이 별 모양으로 표현됩니다" },

  // Shutter Speed
  "shutter-1-30": { label: "1/30 (핸드헬드 블러)", description: "핸드헬드 모션의 미묘한 흔적입니다" },
  "shutter-1-60": { description: "표준적인 일상용 셔터 스피드입니다" },
  "shutter-1-200": { description: "대부분의 피사체에 또렷합니다" },
  "shutter-1-500": { description: "빠른 액션에서도 선명합니다" },
  "shutter-1-1000": { label: "1/1000 (액션 정지)", description: "스포츠/야생동물의 동작을 정지시킵니다" },
  "shutter-long-1s": { label: "장노출 (1초)", description: "광선과 모션 트레일이 만들어집니다" },

  // ISO
  "iso-100": { label: "ISO 100 (클린)", description: "최소한의 노이즈와 미세한 그레인입니다" },
  "iso-400": { description: "약간의 텍스처가 있는 일상용 ISO입니다" },
  "iso-800": { description: "보이지만 기분 좋은 그레인입니다" },
  "iso-1600": { label: "ISO 1600 (가시 그레인)", description: "에디토리얼한 저조도 텍스처입니다" },
  "iso-3200": { label: "ISO 3200 (강한 그레인)", description: "푸시 처리된 거친 다큐멘터리 느낌입니다" },
}

export default map
