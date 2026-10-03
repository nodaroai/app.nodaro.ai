import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { label: "초광각(14mm)", description: "극단적인 광각, 과장된 원근감" },
  "wide-24mm": { label: "광각(24mm)", description: "주변 환경까지 넓게 담는 시야각" },
  "standard-35mm": { label: "준광각(35mm)", description: "자연스러운 원근감, 다큐멘터리 느낌" },
  "normal-50mm": { label: "표준(50mm)", description: "사람의 눈에 가장 가까운 시야" },
  "portrait-85mm": { label: "포트레이트(85mm)", description: "인물을 돋보이게 하는 압축감과 크리미한 보케" },
  "telephoto-135mm": { label: "망원(135mm)", description: "압축된 원근감, 배경에서 분리된 피사체" },
  "super-telephoto-400mm": { label: "초망원(400mm)", description: "극단적인 압축감, 멀리 있는 피사체" },
  "fisheye": { label: "어안", description: "180° 반구형 왜곡" },
  "anamorphic": { label: "아나모픽", description: "시네마틱 와이드스크린, 타원형 보케" },
  "macro": { label: "매크로", description: "작은 디테일을 극단적으로 확대한 클로즈업" },
  "tilt-shift": { label: "틸트 시프트", description: "선택적 초점, 미니어처 효과" },
  "shallow-dof": { label: "얕은 피사계 심도", description: "면도날처럼 얇은 초점, 몽환적인 보케" },
  "canon-k35": { description: "빈티지한 시네마 감성, 따뜻하고 부드러운 피부톤" },
  "cooke-s4": { description: "Cooke 룩 — 크리미하고 회화적인 피부톤" },
  "helios-44": { description: "빈티지 소비에트 렌즈의 소용돌이 보케" },
  "petzval": { label: "Petzval Portrait", description: "초빈티지 소용돌이 보케, 극적인 주변 감광" },
  "probe": { label: "프로브 렌즈", description: "좁은 틈과 구멍을 통과하는 튜브형 매크로" },
  "cctv": { label: "CCTV", description: "감시 카메라 룩" },
}

export default map
