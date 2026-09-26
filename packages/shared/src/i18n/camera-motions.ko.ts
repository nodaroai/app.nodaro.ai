import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Basic
  "auto": { label: "자동", description: "모델이 적절한 카메라 모션을 선택" },
  "static": { label: "고정", description: "고정된 카메라, 움직임 없음" },
  "handheld": { label: "핸드헬드", description: "자연스러운 핸드헬드 흔들림" },
  "steadicam": { label: "스테디캠", description: "부드럽게 안정화된 워킹 샷" },

  // Pan
  "pan-left": { label: "팬 왼쪽", description: "카메라를 왼쪽으로 수평 회전" },
  "pan-right": { label: "팬 오른쪽", description: "카메라를 오른쪽으로 수평 회전" },
  "whip-pan-left": { label: "휩 팬 왼쪽", description: "모션 블러를 동반한 왼쪽 방향의 빠른 휩 팬" },
  "whip-pan-right": { label: "휩 팬 오른쪽", description: "모션 블러를 동반한 오른쪽 방향의 빠른 휩 팬" },

  // Tilt
  "tilt-up": { label: "틸트 업", description: "카메라를 위로 기울임" },
  "tilt-down": { label: "틸트 다운", description: "카메라를 아래로 기울임" },

  // Zoom
  "zoom-in": { label: "줌 인", description: "피사체를 향한 렌즈 줌" },
  "zoom-out": { label: "줌 아웃", description: "피사체에서 멀어지는 렌즈 줌" },
  "crash-zoom-in": { label: "크래시 줌 인", description: "휩 팬처럼 순식간에 치고 들어가는 줌 인" },
  "crash-zoom-out": { label: "크래시 줌 아웃", description: "휩 팬처럼 순식간에 빠져나오는 줌 아웃" },

  // Dolly
  "dolly-in": { label: "돌리 인", description: "피사체를 향해 카메라를 밀어 넣음(시차 효과)" },
  "dolly-out": { label: "돌리 아웃", description: "카메라를 피사체에서 뒤로 빼냄(시차 효과)" },
  "dolly-zoom": { label: "돌리 줌", description: "버티고 효과: 돌리와 줌이 서로 반대로 움직임" },
  "push-in": { label: "푸시 인", description: "피사체를 향해 빠르고 힘차게 밀고 들어감" },
  "pull-out": { label: "풀 아웃", description: "피사체에서 빠르고 힘차게 빠져나오는 풀백" },
  "breathing": { label: "브리딩 카메라", description: "은은하게 계속 오가는 푸시 인과 풀 아웃" },
  "push-pull": { label: "푸시 풀 / 스윙", description: "카메라가 피사체 쪽으로 다가갔다가 다시 멀어지는 움직임" },
  "creep-in": { label: "크리프 인", description: "알아채기 힘들 만큼 천천히 이어지는 푸시 인" },
  "creep-out": { label: "크리프 아웃", description: "알아채기 힘들 만큼 천천히 이어지는 풀 아웃" },

  // Truck
  "truck-left": { label: "트럭 왼쪽", description: "카메라 본체를 왼쪽 옆으로 평행 이동" },
  "truck-right": { label: "트럭 오른쪽", description: "카메라 본체를 오른쪽 옆으로 평행 이동" },

  // Pedestal
  "pedestal-up": { label: "페데스탈 업", description: "카메라 본체를 수직으로 들어 올림" },
  "pedestal-down": { label: "페데스탈 다운", description: "카메라 본체를 수직으로 내림" },

  // Roll
  "roll-left": { label: "롤 왼쪽", description: "카메라를 반시계 방향으로 회전" },
  "roll-right": { label: "롤 오른쪽", description: "카메라를 시계 방향으로 회전" },
  "dutch-angle": { label: "더치 앵글", description: "긴장감을 주는, 고정된 채 기울어진 프레임" },

  // Orbit / Arc
  "orbit-left": { label: "오비트 왼쪽", description: "피사체 주위를 왼쪽으로 크게 도는 부분 궤도" },
  "orbit-right": { label: "오비트 오른쪽", description: "피사체 주위를 오른쪽으로 크게 도는 부분 궤도" },
  "spin-360": { label: "풀 360° 스핀", description: "카메라가 제자리 축을 중심으로 360도 완전히 회전" },
  "orbit-360": { label: "풀 360° 오비트", description: "피사체 주위를 360도 완전히 도는 원형 궤도" },
  "arc-left": { label: "아크 왼쪽", description: "피사체 주위를 왼쪽으로 일부만 도는 호" },
  "arc-right": { label: "아크 오른쪽", description: "피사체 주위를 오른쪽으로 일부만 도는 호" },

  // Crane / Jib
  "crane-up": { label: "크레인 업", description: "장면을 드러내며 크게 솟아오르는 크레인 샷" },
  "crane-down": { label: "크레인 다운", description: "크게 휩쓸며 내려오는 크레인 샷" },
  "boom-up": { label: "붐 업", description: "붐 암 상승" },
  "boom-down": { label: "붐 다운", description: "붐 암 하강" },

  // Tracking
  "tracking-shot": { label: "트래킹 샷", description: "움직이는 피사체를 옆에서 따라가는 카메라" },
  "follow": { label: "팔로우", description: "피사체를 뒤에서 따라가는 카메라" },
  "lead": { label: "리드", description: "전진하는 피사체보다 앞서 이동하는 카메라" },
  "drone-follow": { label: "드론 팔로우", description: "높은 곳에서 피사체를 추적하는 드론" },
  "dolly-track": { label: "돌리 트랙", description: "피사체와 나란히 깔린 트랙 위를 움직이는 돌리" },
  "gimbal-walk": { label: "짐벌 워크", description: "3축 짐벌로 부드럽게 걸으며 찍는 샷" },
  "ronin-glide": { label: "Ronin 글라이드", description: "Ronin/Movi 짐벌로 천천히 미끄러지듯 움직이는 샷" },
  "serpentine": { label: "서펜타인 트랙", description: "장애물 사이를 S자 곡선으로 누비는 카메라" },

  // Special angles / rigs
  "pov": { label: "POV", description: "1인칭 시점" },
  "over-the-shoulder": { label: "오버 더 숄더", description: "캐릭터의 어깨 너머로 잡은 프레임" },
  "birds-eye": { label: "버즈 아이", description: "바로 위에서 수직으로 내려다보는 부감" },
  "worms-eye": { label: "웜즈 아이", description: "위를 올려다보는 극단적 로우 앵글" },
  "aerial": { label: "에어리얼", description: "고고도 드론 스타일 샷" },
  "helicopter": { label: "헬리콥터", description: "높은 고도에서 넓게 훑는 항공 샷" },
  "fly-over": { label: "플라이 오버", description: "장면 위를 낮고 빠르게 지나가는 항공 샷" },
  "flythrough": { label: "플라이스루", description: "공간을 가로질러 비행하는 카메라" },
  "reveal": { label: "리빌", description: "더 넓은 장면을 서서히 드러냄" },
  "snorricam": { label: "스노리캠", description: "몸에 장착한 카메라(피사체가 프레임에 고정됨)" },
  "rack-focus": { label: "랙 포커스", description: "전경과 배경 사이에서 초점 이동" },

  // Modern / social-video vocabulary
  "handheld-vlog": { label: "핸드헬드 브이로그", description: "캐주얼한 브이로그 스타일 핸드헬드" },
  "pov-walk": { label: "POV 워크", description: "1인칭 보행 POV" },
  "velocity-edit": { label: "벨로시티 에디트", description: "TikTok식 스피드 램프 편집 리듬" },
  "match-cut-zoom": { label: "매치 컷 줌", description: "비슷한 형태의 샷으로 하드 컷되는 빠른 줌" },
  "screen-tap": { label: "스크린 탭", description: "화면 위 손가락 탭 트랜지션" },
  "phone-flip": { label: "폰 플립", description: "전면/후면 카메라 전환" },
  // Location-studio extension (PR #2505 follow-up)
  "gentle-drift": { label: "완만한 드리프트", description: "느리게 떠다니는 잔잔한 움직임" },
  "parallax": { label: "패럴랙스", description: "전경과 배경의 깊이 분리가 있는 측면 움직임" },
}

export default map
