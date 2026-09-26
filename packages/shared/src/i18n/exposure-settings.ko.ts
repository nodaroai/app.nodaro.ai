import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Aperture (technical units stay in alphanumeric)
  "aperture-f1-2": { description: "극도로 얕은 피사계 심도, 몽환적인 보케" },
  "aperture-f1-4": { description: "피사체를 배경에서 과감하게 분리" },
  "aperture-f1-8": { description: "클래식한 인물 사진의 배경 분리" },
  "aperture-f2-8": { description: "또렷한 피사체, 부드러운 배경" },
  "aperture-f4": { description: "균형 잡힌 일상적인 피사계 심도" },
  "aperture-f5-6": { description: "피사체 전체에 걸친 또렷한 초점" },
  "aperture-f8": { description: "스위트 스팟의 최대 선명도" },
  "aperture-f11": { description: "풍경 사진에 알맞은 깊은 피사계 심도" },
  "aperture-f16": { description: "과초점 거리, 태양의 빛갈라짐" },

  // Shutter Speed
  "shutter-1-30": { label: "1/30(핸드헬드 블러)", description: "핸드헬드 특유의 미세한 흔들림" },
  "shutter-1-60": { description: "일상 촬영의 표준 셔터 스피드" },
  "shutter-1-200": { description: "대부분의 피사체를 또렷하게 포착" },
  "shutter-1-500": { description: "빠른 움직임도 선명하게 포착" },
  "shutter-1-1000": { label: "1/1000(액션 정지)", description: "순간을 멈춘 스포츠/야생동물" },
  "shutter-long-1s": { label: "장노출(1초)", description: "빛줄기와 모션 트레일" },

  // ISO
  "iso-100": { label: "ISO 100(클린)", description: "최소한의 노이즈와 미세한 그레인" },
  "iso-400": { description: "약간의 텍스처가 있는 일상용 ISO" },
  "iso-800": { description: "눈에 띄지만 보기 좋은 그레인" },
  "iso-1600": { label: "ISO 1600(눈에 띄는 그레인)", description: "에디토리얼한 저조도 텍스처" },
  "iso-3200": { label: "ISO 3200(강한 그레인)", description: "푸시 처리된 거친 다큐멘터리 느낌" },
}

export default map
