import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Time of day
  "sunrise": { label: "일출", description: "따뜻하고 낮은 태양, 긴 그림자입니다" },
  "golden-hour": { label: "골든 아워", description: "따뜻한 노을빛입니다" },
  "noon": { label: "정오", description: "강한 머리 위 한낮의 태양입니다" },
  "harsh-midday": { label: "한낮의 강한 햇볕", description: "탈색된 흰 태양의 천정입니다" },
  "overcast": { label: "흐림", description: "부드럽게 확산된 일광입니다" },
  "blue-hour": { label: "블루 아워", description: "차가운 황혼의 트와일라잇입니다" },
  "twilight": { label: "트와일라잇", description: "블루 아워와 밤 사이입니다" },
  "night": { label: "밤", description: "깊은 밤, 낮은 주변광입니다" },
  "moonlight": { label: "달빛", description: "차가운 푸른 달빛 풍경입니다" },
  "neon-night": { label: "네온 나이트", description: "채도 높은 네온 도시의 밤입니다" },

  // Style
  "three-point": { label: "삼점 조명", description: "키 + 필 + 백의 클래식 조명입니다" },
  "rembrandt": { label: "렘브란트", description: "뺨에 빛의 삼각형이 떨어지는 스타일입니다" },
  "chiaroscuro": { description: "강한 명암 대비입니다" },
  "silhouette": { label: "실루엣", description: "순수한 형태로 표현된 피사체입니다" },
  "high-key": { label: "하이키", description: "밝고 저대비입니다" },
  "low-key": { label: "로우키", description: "어둡고 고대비입니다" },
  "split": { label: "스플릿", description: "절반은 빛, 절반은 그림자인 얼굴입니다" },
  "hard": { label: "하드", description: "날카로운 그림자 가장자리입니다" },
  "soft": { label: "소프트", description: "확산된 부드러운 빛입니다" },
  "practical": { label: "프랙티컬", description: "장면 안에 보이는 광원들입니다" },
  "ring-light": { label: "링 라이트", description: "뷰티/블로그 링 캐치라이트입니다" },
  "phone-screen-glow": { label: "폰 스크린 글로우", description: "차가운 화면 아래 조명입니다" },
  "selfie-natural": { label: "셀카 내추럴", description: "창문 빛 셀카입니다" },
  "natural": { label: "내추럴", description: "사용 가능한 주변광입니다" },
  "volumetric": { label: "볼류메트릭", description: "안개 속 가시 광선 빔입니다" },
  "noir": { label: "느와르", description: "고대비 흑백 필름 느와르입니다" },
  "on-camera-flash": { label: "온 카메라 플래시", description: "파파라치/아이폰 직접 플래시입니다" },
  "mirror-bounce-flash": { label: "거울 바운스 플래시", description: "거울 셀카 플래시 바운스입니다" },
  "bounced-flash": { label: "바운스 플래시", description: "부드러운 천장 바운스 필 라이트입니다" },
  "softbox-key": { label: "소프트박스 키", description: "큼직하게 확산된 패션 키 라이트입니다" },
  "beauty-dish": { label: "뷰티 디시", description: "히어로 라이트, 또렷한 폴오프입니다" },
  "gridded-snoot": { label: "그리드 스누트", description: "타이트하게 집중된 빛의 풀입니다" },
  "silk-diffusion": { label: "실크 디퓨전", description: "실크로 부드러워진 키 라이트입니다" },
  "kicker-rim": { label: "키커 / 림 액센트", description: "낮은 측면의 액센트 분리 라이트입니다" },
  "candlelight": { label: "촛불", description: "따뜻하게 깜빡이는 불빛입니다" },
  "edison-tungsten": { label: "에디슨 텅스텐", description: "아늑하고 따뜻한 글로브 전구의 빛입니다" },
  "dappled-light": { label: "다플드 / 잎새 사이 빛", description: "잎으로 얼룩진 빛입니다" },
  "raking-sidelight": { label: "레이킹 사이드라이트", description: "극단적으로 낮은 측면, 텍스처를 강조합니다" },
  "stage-spotlight": { label: "스테이지 스포트라이트", description: "단일의 강한 머리 위 스폿입니다" },
  "underwater-caustics": { label: "수중 코스틱", description: "물결치는 굴절 패턴입니다" },
  "bioluminescence": { label: "생체 발광", description: "차갑고 기묘한 생물학적 빛입니다" },

  // Direction
  "front": { label: "정면", description: "카메라 방향에서 오는 빛입니다" },
  "three-quarter": { label: "3/4 라이트", description: "클래식 인물 사진 키 앵글입니다" },
  "side": { label: "측면", description: "한쪽에서 오는 빛입니다" },
  "back-rim": { label: "백 / 림", description: "피사체 주위에 림을 만드는 백라이트입니다" },
  "silhouette-backlight": { label: "실루엣 백라이트", description: "밝은 후광, 어두운 피사체입니다" },
  "top-overhead": { label: "탑 / 오버헤드", description: "정수직 위에서 오는 빛입니다" },
  "under-uplight": { label: "언더 / 업라이트", description: "아래에서 오는 빛입니다" },
  "window": { label: "창문", description: "창문에서 오는 부드러운 측면광입니다" },

  // Lighting ratio (technical alphanumeric)
  "ratio-1-1": { description: "평면적, 그림자 대비 없음입니다" },
  "ratio-1-2": { description: "1스탑 정도의 부드러운 폴오프입니다" },
  "ratio-1-3": { description: "2스탑 정도의 중간 대비입니다" },
  "ratio-1-4": { description: "강한 에디토리얼한 대비입니다" },
  "ratio-1-8": { description: "극단적 로우키 키아로스쿠로입니다" },
  "ratio-1-16": { description: "단일 광원의 필름 느와르 폴오프입니다" },

  // Color temperature (technical Kelvin units stay in alphanumeric)
  "temp-2700k": { label: "2700K 캔들", description: "진한 호박색 캔들/텅스텐입니다" },
  "temp-3200k": { label: "3200K 텅스텐", description: "따뜻한 노란색 실내 조명입니다" },
  "temp-4000k": { label: "4000K 믹스", description: "중성 화이트입니다" },
  "temp-5600k": { label: "5600K 데이라이트", description: "데이라이트 균형의 한낮 태양입니다" },
  "temp-6500k": { label: "6500K 흐림", description: "약간 차가운 푸른 캐스트입니다" },
  "temp-9000k": { label: "9000K 그늘", description: "확연히 차가운 푸른 그늘입니다" },

  // Portrait setups
  "butterfly": { label: "버터플라이 라이팅", description: "위에서 비춘 빛이 코 아래에 나비 모양 그림자를 만듭니다" },
  "loop": { label: "루프 라이팅", description: "약간 측면 위에서 비춘 빛이 뺨에 작은 루프 그림자를 만듭니다" },
  "broad": { label: "브로드 라이팅", description: "카메라를 향한 쪽이 밝아 얼굴이 더 넓게 보입니다" },
  "short": { label: "쇼트 라이팅", description: "카메라 반대쪽이 밝아 얼굴이 슬림해 보입니다" },
  "hatchet": { label: "해칫 라이팅", description: "위에서 스쳐 비춰 반대쪽에 짙은 그림자가 드리웁니다" },
  "clamshell": { label: "클램셸 라이팅", description: "위 + 아래 리플렉터로 샌드위치된 뷰티 라이팅입니다" },
}

export default map
