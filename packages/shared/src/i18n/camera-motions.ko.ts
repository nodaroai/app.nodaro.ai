import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Basic
  "auto": { label: "자동", description: "모델이 적절한 카메라 모션을 선택합니다" },
  "static": { label: "고정", description: "고정된 카메라이며 움직임이 없습니다" },
  "handheld": { label: "핸드헬드", description: "자연스러운 핸드헬드 흔들림입니다" },
  "steadicam": { label: "스테디캠", description: "부드럽게 안정화된 워킹 샷입니다" },

  // Pan
  "pan-left": { label: "팬 왼쪽", description: "카메라를 수평으로 왼쪽으로 회전합니다" },
  "pan-right": { label: "팬 오른쪽", description: "카메라를 수평으로 오른쪽으로 회전합니다" },
  "whip-pan-left": { label: "휩 팬 왼쪽", description: "모션 블러를 동반한 빠른 휩 팬 왼쪽입니다" },
  "whip-pan-right": { label: "휩 팬 오른쪽", description: "모션 블러를 동반한 빠른 휩 팬 오른쪽입니다" },

  // Tilt
  "tilt-up": { label: "틸트 업", description: "카메라를 위로 기울입니다" },
  "tilt-down": { label: "틸트 다운", description: "카메라를 아래로 기울입니다" },

  // Zoom
  "zoom-in": { label: "줌 인", description: "피사체를 향한 렌즈 줌입니다" },
  "zoom-out": { label: "줌 아웃", description: "피사체에서 멀어지는 렌즈 줌입니다" },
  "crash-zoom-in": { label: "크래시 줌 인", description: "스내피한 휩 스타일 줌 인입니다" },
  "crash-zoom-out": { label: "크래시 줌 아웃", description: "스내피한 휩 스타일 줌 아웃입니다" },

  // Dolly
  "dolly-in": { label: "달리 인", description: "피사체를 향해 카메라를 밀어 넣습니다 (시차)" },
  "dolly-out": { label: "달리 아웃", description: "카메라를 멀리 밀어냅니다 (시차)" },
  "dolly-zoom": { label: "달리 줌", description: "버티고 효과: 달리와 줌이 반대로 동작합니다" },
  "push-in": { label: "푸시 인", description: "피사체를 향한 천천히 미묘한 푸시입니다" },
  "pull-out": { label: "풀 아웃", description: "피사체로부터 천천히 미묘한 풀백입니다" },
  "breathing": { label: "브리딩 카메라", description: "은은하게 지속되는 푸시 인 / 풀 아웃의 진동, 유기적인 핸드헬드 느낌입니다" },
  "push-pull": { label: "푸시 풀 / 스윙", description: "카메라가 피사체를 향해 다가갔다가 다시 멀어지는, 흔들리는 접근과 후퇴입니다" },
  "creep-in": { label: "크리프 인", description: "감지하기 어려울 만큼 느린 푸시 인으로 공포감이나 긴장감을 쌓아갑니다" },
  "creep-out": { label: "크리프 아웃", description: "감지하기 어려울 만큼 느린 풀 아웃으로 피사체를 공간 속에 고립시킵니다" },

  // Truck
  "truck-left": { label: "트럭 왼쪽", description: "카메라 본체를 측면으로 왼쪽으로 슬라이드합니다" },
  "truck-right": { label: "트럭 오른쪽", description: "카메라 본체를 측면으로 오른쪽으로 슬라이드합니다" },

  // Pedestal
  "pedestal-up": { label: "페데스탈 업", description: "카메라 본체를 수직으로 들어 올립니다" },
  "pedestal-down": { label: "페데스탈 다운", description: "카메라 본체를 수직으로 내립니다" },

  // Roll
  "roll-left": { label: "롤 왼쪽", description: "카메라를 반시계 방향으로 회전합니다" },
  "roll-right": { label: "롤 오른쪽", description: "카메라를 시계 방향으로 회전합니다" },
  "dutch-angle": { label: "더치 앵글", description: "긴장감을 주는 정적 기울어진 프레임입니다" },

  // Orbit / Arc
  "orbit-left": { label: "오비트 왼쪽", description: "피사체 주위를 왼쪽으로 한 바퀴 도는 궤도입니다" },
  "orbit-right": { label: "오비트 오른쪽", description: "피사체 주위를 오른쪽으로 한 바퀴 도는 궤도입니다" },
  "spin-360": { label: "풀 360° 스핀", description: "카메라가 자신의 축을 중심으로 360도 완전 회전합니다" },
  "orbit-360": { label: "풀 360° 오비트", description: "카메라가 피사체 주위를 360도 완전한 호로 돕니다" },
  "arc-left": { label: "아크 왼쪽", description: "피사체 주위를 왼쪽으로 부분적으로 도는 호입니다" },
  "arc-right": { label: "아크 오른쪽", description: "피사체 주위를 오른쪽으로 부분적으로 도는 호입니다" },

  // Crane / Jib
  "crane-up": { label: "크레인 업", description: "장면을 드러내며 휩쓸듯 올라가는 크레인 상승입니다" },
  "crane-down": { label: "크레인 다운", description: "휩쓸듯 내려오는 크레인 하강입니다" },
  "boom-up": { label: "붐 업", description: "붐 암 상승입니다" },
  "boom-down": { label: "붐 다운", description: "붐 암 하강입니다" },

  // Tracking
  "tracking-shot": { label: "트래킹 샷", description: "움직이는 피사체를 옆에서 따라가는 카메라입니다" },
  "follow": { label: "팔로우", description: "피사체를 뒤에서 따라갑니다" },
  "lead": { label: "리드", description: "전진하는 피사체보다 앞서 이동합니다" },
  "drone-follow": { label: "드론 팔로우", description: "피사체를 추적하는 고도의 드론입니다" },
  "dolly-track": { label: "달리 트랙", description: "피사체와 평행한 트랙 위의 달리입니다" },
  "gimbal-walk": { label: "짐벌 워크", description: "3축 짐벌로 부드럽게 걷는 샷, 떠다니듯 안정된 전진 움직임입니다" },
  "ronin-glide": { label: "Ronin 글라이드", description: "Ronin / Movi 짐벌 위에서의 느린 미끄러지는 움직임, 흔들림 없는 시네마틱한 부유감입니다" },
  "serpentine": { label: "서펜타인 트랙", description: "카메라가 장애물 사이를 S자 곡선으로 누비며, 굽이치는 전진 경로를 그립니다" },

  // Special angles / rigs
  "pov": { label: "POV", description: "1인칭 시점입니다" },
  "over-the-shoulder": { label: "오버 더 숄더", description: "캐릭터의 어깨 너머로 프레임합니다" },
  "birds-eye": { label: "버즈 아이", description: "정수직 탑다운 오버헤드 뷰입니다" },
  "worms-eye": { label: "웜즈 아이", description: "위를 올려다보는 극단적 로우 앵글입니다" },
  "aerial": { label: "에어리얼", description: "고고도 드론 스타일 샷입니다" },
  "helicopter": { label: "헬리콥터", description: "고고도의 넓고 휩쓰는 항공 샷입니다" },
  "fly-over": { label: "플라이 오버", description: "장면 위를 빠르게 지나는 저고도 항공 패스입니다" },
  "flythrough": { label: "플라이스루", description: "공간을 가로질러 비행하는 카메라입니다" },
  "reveal": { label: "리빌", description: "더 넓은 장면을 점차적으로 드러냅니다" },
  "snorricam": { label: "스노리캠", description: "몸에 장착된 카메라(피사체가 프레임에 고정됨)입니다" },
  "rack-focus": { label: "랙 포커스", description: "전경과 배경 사이로 초점을 이동시킵니다" },

  // Modern / social-video vocabulary
  "handheld-vlog": { label: "핸드헬드 블로그", description: "캐주얼한 블로그 스타일 핸드헬드입니다" },
  "pov-walk": { label: "POV 워크", description: "1인칭 보행 POV입니다" },
  "velocity-edit": { label: "벨로시티 에디트", description: "TikTok 스피드 램프 페이싱입니다" },
  "match-cut-zoom": { label: "매치 컷 줌", description: "컷에 맞춘 비트 타이밍 줌입니다" },
  "screen-tap": { label: "스크린 탭", description: "화면 위 손가락 탭 트랜지션입니다" },
  "phone-flip": { label: "폰 플립", description: "전면/후면 카메라 플립입니다" },
}

export default map
