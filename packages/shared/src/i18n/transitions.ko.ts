import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto": { label: "자동", description: "모델이 선택하도록 맡김" },
  "none": { label: "하드 컷", description: "즉각적인 전환, 트랜지션 없음" },
  "cross-dissolve": { label: "크로스 디졸브", description: "샷 간의 점진적인 블렌드" },
  "fade-to-black": { label: "페이드 투 블랙", description: "화면이 어두워지고 두 번째 장면이 등장" },
  "fade-to-white": { label: "페이드 투 화이트", description: "화면이 밝아지고 두 번째 장면이 등장" },
  "match-cut": { label: "매치 컷", description: "샷 간 형태나 동작의 시각적 운율" },
  "smash-cut": { label: "스매시 컷", description: "대조적인 샷 사이의 충격적인 급전환" },
  "iris": { label: "아이리스", description: "원형 조리개가 닫히고 두 번째 장면에서 열림" },
  "wipe": { label: "와이프", description: "직선 와이프로 첫 번째 샷을 대체" },
  "roll-transition": { label: "롤", description: "프레임이 90–180° 회전 후 두 번째 샷이 안정됨" },
  "seamless-match": { label: "심리스 매치", description: "동작과 색상으로 위장한 보이지 않는 컷" },

  // ── Time ──
  "fast-forward-day-night": { label: "낮→밤 타임랩스", description: "같은 장면에서 낮에서 밤으로의 타임랩스" },
  "fast-forward-night-day": { label: "밤→새벽 타임랩스", description: "같은 장면에서 밤에서 새벽으로의 타임랩스" },
  "seasonal-shift": { label: "계절 변화", description: "같은 장면에서 사계절이 흘러감" },
  "aging": { label: "노화", description: "피사체가 눈에 띄게 늙어감" },
  "rewind": { label: "되감기", description: "시간이 역행하며 동작이 거꾸로 재생" },
  "freeze-frame-jump": { label: "정지 프레임 점프", description: "동작이 멈추고 시간이 앞으로 도약" },
  "weather-shift": { label: "날씨 변화", description: "같은 장면에서 날씨가 바뀜" },
  "flashback": { label: "플래시백", description: "피사체의 과거 순간으로의 기억 회상" },

  // ── Element ──
  "dissolve-to-mist": { label: "안개로 용해", description: "피사체가 안개로 변해 흩어졌다 재형성" },
  "water-splash": { label: "물 스플래시", description: "피사체가 물로 변해 튀었다 재형성" },
  "sand-scatter": { label: "모래 흩날림", description: "피사체가 모래로 변해 날아갔다 재형성" },
  "fire-burnup": { label: "연소", description: "피사체가 불타 잉걸불이 되고 재형성" },
  "smoke-puff": { label: "연기 소환", description: "피사체가 연기로 사라졌다 다시 나타남" },
  "magic-sparkles": { label: "마법 입자", description: "어벤져스 스타일의 입자 분해" },
  "lightning-flash": { label: "번개 섬광", description: "번개가 화면을 가르고 섬광 속에서 장면 전환" },
  "ink-splash": { label: "잉크 스플래시", description: "잉크가 화면을 덮었다 수축하며 새 장면 등장" },
  "sand-storm": { label: "모래폭풍", description: "모래폭풍이 화면을 삼키고 내부에서 장면 전환" },
  "paint-splash": { label: "물감 스플래시", description: "선명한 물감이 덮었다 수축하며 새 장면 등장" },
  "aurora-sweep": { label: "오로라 스윕", description: "오로라 커튼이 화면을 스쳐 지나가며 장면 전환" },
  "sakura-petals": { label: "벚꽃 폭풍", description: "벚꽃 잎사귀 폭풍이 화면을 가로지름" },
  "garden-bloom": { label: "정원 개화", description: "꽃이 사방으로 피어 새 장면을 드러냄" },
  "powder-burst": { label: "색 가루 폭발", description: "색 가루가 폭발 후 사라지며 새 장면 등장" },

  // ── Morph ──
  "liquid-morph": { label: "액체 변형", description: "피사체가 액화되어 새 피사체로 변형" },
  "pixelate-reform": { label: "픽셀화 재형성", description: "픽셀화되어 흩어진 뒤 재조합" },
  "shatter-glass": { label: "유리 파열 재형성", description: "피사체가 유리처럼 깨진 뒤 재조합" },
  "origami-fold": { label: "종이접기 변형", description: "피사체가 종이처럼 접혀 새 형태로" },
  "vortex-swirl": { label: "소용돌이 변형", description: "피사체가 소용돌이로 빨려들어 새 형태로" },
  "dream-ripple": { label: "꿈의 파문", description: "수면 파문처럼 퍼져 새 장면 등장" },
  "wireframe-morph": { label: "와이어프레임 변형", description: "피사체가 와이어프레임으로 환원 후 새 피사체로" },
  "polygon-shatter": { label: "폴리곤 파열", description: "피사체가 폴리곤으로 부서져 새 형태로 재조합" },
  "melt-down": { label: "용해 재생", description: "피사체가 녹아 웅덩이가 되고 새 형태로 솟아오름" },

  // ── Portal ──
  "zoom-into-eye": { label: "눈 속으로 줌", description: "동공으로 밀고 들어가면 새 세계가" },
  "zoom-into-mirror": { label: "거울 속으로 줌", description: "거울로 밀어 들어가 반사된 세계로" },
  "zoom-into-screen": { label: "화면 속으로 줌", description: "TV/스마트폰/모니터 화면 속으로" },
  "zoom-into-book": { label: "책 속으로 줌", description: "책 삽화 속으로 밀어 들어감" },
  "walk-through-door": { label: "문을 통과", description: "문을 통해 새로운 장면으로" },
  "fall-into-hole": { label: "구멍으로 추락", description: "구멍을 통해 카메라가 추락" },
  "pull-out-reveal": { label: "풀 아웃 리빌", description: "첫 장면이 더 큰 맥락 속의 그림이었음을 드러냄" },
  "zoom-into-mouth": { label: "입 속으로 줌", description: "열린 입 속으로 밀어 들어가 새 세계로" },
  "push-through-glass": { label: "유리를 통과", description: "카메라가 유리 면을 굴절하며 통과해 새 세계로" },
  "soul-jump": { label: "영혼 점프", description: "반투명한 영혼이 몸을 떠나 새 몸으로 들어감" },

  // ── Physics ──
  "explosion-blast": { label: "폭발", description: "폭발이 화면을 쓸어내고 새 장면이 드러남" },
  "shockwave": { label: "충격파", description: "충격파가 화면을 일그러뜨리며 장면 전환" },
  "punch-into-camera": { label: "카메라 펀치", description: "주먹이 카메라에 충격을 주며 장면 전환" },
  "debris-shower": { label: "파편 소나기", description: "파편이 지나가며 뒤의 장면이 바뀜" },
  "gravity-flip": { label: "중력 반전", description: "중력이 반전되고 카메라가 180° 회전" },
  "building-explosion": { label: "건물 폭발", description: "건물이 폭발하고 연기 속에서 장면 전환" },
  "vehicle-explosion": { label: "차량 폭발", description: "전경의 차량이 폭발하고 연기 걷히면 새 장면" },
  "jump-match": { label: "점프 매치", description: "피사체가 점프하고 착지가 새 장면과 연결" },
  "hand-swipe": { label: "손 스와이프", description: "손이 렌즈를 가리는 사이 장면이 전환됨" },

  // ── Light ──
  "white-flash": { label: "화이트 플래시", description: "화면이 순백으로 빛남" },
  "lens-flare-swipe": { label: "렌즈 플레어 스윕", description: "아나모픽 렌즈 플레어가 화면을 가로지름" },
  "light-streak": { label: "빛 줄기 스윕", description: "빛의 줄기가 화면을 가로질러 장면 전환" },
  "color-invert": { label: "색 반전 플래시", description: "색상이 순간적으로 반전됨" },
  "sun-glare": { label: "태양 눈부심", description: "강렬한 태양 눈부심이 화면을 씻어냄" },
  "lens-crack": { label: "렌즈 균열", description: "렌즈가 갈라지고 균열된 유리 너머로 새 장면" },
  "dirty-lens-wipe": { label: "오염 렌즈 닦기", description: "렌즈 오염이 닦이며 장면이 전환됨" },
  "eye-light-burst": { label: "눈빛 폭발", description: "피사체의 눈에서 강렬한 빔이 뿜어져 화면 화이트아웃" },

  // ── Glitch ──
  "digital-glitch": { label: "디지털 글리치", description: "RGB 분리+스캔라인+데이터모시 글리치" },
  "vhs-rewind": { label: "VHS 되감기", description: "VHS 테이프 되감기 스타일 트래킹 왜곡" },
  "datamosh": { label: "데이터모쉬", description: "모션 벡터가 두 장면을 번지게 하며 전환" },
  "channel-flip": { label: "채널 전환", description: "TV 정전기와 함께 채널이 바뀌는 효과" },
  "hologram-flicker": { label: "홀로그램 깜빡임", description: "홀로그램 깜빡임 속에서 새 장면이 출현" },
  "display-wipe": { label: "디스플레이 와이프", description: "장면이 화면으로 압축되었다 새 장면으로 펼쳐짐" },
  "double-exposure": { label: "이중 노출", description: "두 장면이 반투명하게 겹치며 첫 장면이 사라짐" },
}

export default map
