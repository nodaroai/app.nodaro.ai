import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { label: "초광각 (14mm)", description: "극단적인 광각, 과장된 원근감입니다" },
  "wide-24mm": { label: "광각 (24mm)", description: "넓은 시야각, 환경 표현에 적합합니다" },
  "standard-35mm": { label: "표준 (35mm)", description: "자연스러운 원근감, 다큐멘터리한 느낌입니다" },
  "normal-50mm": { label: "노멀 (50mm)", description: "사람의 눈 인식에 가장 가깝습니다" },
  "portrait-85mm": { label: "포트레이트 (85mm)", description: "보기 좋은 압축감과 크리미한 보케입니다" },
  "telephoto-135mm": { label: "망원 (135mm)", description: "압축된 깊이감, 분리된 피사체입니다" },
  "super-telephoto-400mm": { label: "초망원 (400mm)", description: "극단적 압축, 멀리 있는 피사체입니다" },
  "fisheye": { label: "어안", description: "180° 반구형 왜곡입니다" },
  "anamorphic": { label: "아나모픽", description: "시네마틱 와이드스크린, 타원형 보케입니다" },
  "macro": { label: "매크로", description: "작은 디테일의 극단적 클로즈업입니다" },
  "tilt-shift": { label: "틸트 시프트", description: "선택적 초점, 미니어처 효과입니다" },
  "shallow-dof": { label: "얕은 DOF", description: "면도날처럼 얇은 초점, 몽환적인 보케입니다" },
  "canon-k35": { description: "빈티지하고 시네마틱, 따뜻하고 부드러운 피부톤입니다" },
  "cooke-s4": { description: "Cooke 룩 — 크리미하고 회화적인 피부톤입니다" },
  "helios-44": { description: "빈티지 소비에트의 소용돌이 보케입니다" },
  "petzval": { label: "Petzval Portrait", description: "초빈티지 소용돌이, 극적인 폴오프입니다" },
  "probe": { label: "프로브 렌즈", description: "좁은 틈과 구멍을 통과하는 튜브형 매크로" },
  "cctv": { label: "CCTV", description: "감시 카메라 룩" },
}

export default map
