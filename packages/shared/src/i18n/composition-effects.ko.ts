import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "none": { label: "없음", description: "구도 효과 없음" },
  "bursting-through-frame": { label: "프레임을 뚫고 나오기", description: "프레임을 찢고 나오는 3D 종이 찢김 효과" },
  "breaking-out-of-frame": { label: "프레임 밖으로 나오기", description: "캔버스 경계 너머로 뻗어 나온 팔다리" },
  "pixel-disintegration": { label: "픽셀 분해", description: "입자로 분해되어 흩어지는 피사체" },
  "smoke-sculpture": { label: "연기 조각", description: "소용돌이치는 연기로 이루어진 피사체" },
  "liquid-sculpture": { label: "액체 조각", description: "흐르는 액체로 이루어진 피사체" },
  "shattering-glass": { label: "산산이 부서지는 유리", description: "공중에 정지한 유리 파편" },
  "emerging-from-background": { label: "배경에서 떠오르기", description: "텍스처가 있는 표면에서 반쯤 떠오르는 모습" },
  "fragmented-mosaic": { label: "조각난 모자이크", description: "모자이크 타일로 구성된 초상화" },
  "glitch-distortion": { label: "글리치 디스토션", description: "RGB 시프트 디지털 손상" },
  "doubled-mirror": { label: "이중 거울", description: "거울에 반사되어 복제된 이미지" },
  "floating-fragments": { label: "떠다니는 파편", description: "몸 일부가 떠다니며 흩어지는 모습" },
  "silhouette-outline": { label: "실루엣 아웃라인", description: "단색 배경 위의 깔끔한 검은 실루엣" },
  "exploding-particles": { label: "폭발하는 입자", description: "입자로 흩어지는 윤곽" },

  // Additional composition effects
  "matte-painting": { label: "매트 페인팅", description: "실사와 합성한 매트 페인팅 배경, 고전적인 VFX 기법" },
  "double-exposure": { label: "이중 노출", description: "두 번의 노출을 겹쳐 한 장의 이미지로 합친 모습" },
  "multiple-exposure": { label: "다중 노출", description: "세 번 이상의 노출을 겹친 만화경 같은 레이어" },
  "in-camera-effects": { label: "인카메라 효과", description: "후반 작업 없이 카메라로 직접 구현한 광학 효과" },
  "prism-flares": { label: "프리즘 플레어", description: "크리스털 프리즘에 굴절되어 스펙트럼 띠로 갈라지는 라이트 플레어" },
}

export default map
