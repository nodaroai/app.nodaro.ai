import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Palette
  "warm": { label: "웜", description: "따뜻한 주황/빨강 톤" },
  "cool": { label: "쿨", description: "차가운 파랑/틸 톤" },
  "teal-orange": { label: "틸 & 오렌지", description: "할리우드 스타일의 보색 그레이딩" },
  "split-toning": { label: "스플릿 토닝", description: "차가운 섀도우, 따뜻한 하이라이트" },
  "selective-color": { label: "선택 컬러", description: "한 가지 액센트 컬러를 더한 흑백" },
  "faded-matte": { label: "빛바랜 매트", description: "리프트된 블랙과 뿌연 저대비" },
  "log-flat": { label: "Log 플랫", description: "그레이딩 전의 뉴트럴한 S-Log/V-Log 톤" },
  "desaturated": { label: "저채도", description: "낮은 채도의 차분한 톤" },
  "monochrome-bw": { label: "모노크롬 흑백", description: "완전한 흑백" },
  "sepia": { label: "세피아", description: "빈티지한 갈색 톤" },
  "pastel": { label: "파스텔", description: "부드러운 저대비 파스텔" },
  "high-contrast": { label: "하이 콘트라스트", description: "쨍한 대비와 깊은 블랙" },
  "vibrant": { label: "비비드", description: "고채도의 화려한 컬러" },

  // Film emulation (mostly product names — keep in English)
  "kodak-portra": { description: "부드러운 피부톤과 미세한 그레인" },
  "kodak-ektar": { description: "고채도, 미세한 그레인" },
  "kodak-vision3": { description: "영화 촬영용 필름 스톡" },
  "fuji-pro-400h": { description: "파스텔 톤의 그린과 하늘" },
  "cinestill-800t": { description: "레드 헐레이션이 나타나는 텅스텐 필름" },
  "bleach-bypass": { label: "블리치 바이패스", description: "고대비, 저채도 룩" },
  "technicolor": { label: "Technicolor 3-strip", description: "선명한 레트로 Technicolor 룩" },
  "two-strip-technicolor": { label: "Two-Strip Technicolor", description: "1920~30년대의 레드-블루 Technicolor" },
  "eastman-color": { description: "1950~60년대의 따뜻하고 바랜 필름 스톡" },
  "hand-tinted": { label: "손 채색", description: "손으로 색을 입힌 흑백" },
  "agfa-orwo": { description: "동유럽 스타일의 차가운 그린 톤" },
  "day-for-night": { label: "데이 포 나이트", description: "낮을 밤처럼 그레이딩한 룩" },
  "cross-processed": { label: "크로스 프로세스", description: "크로스 프로세스로 인한 컬러 시프트" },

  // Social-preset
  "instagram-warm": { label: "Instagram 웜", description: "Valencia 스타일의 따뜻한 필터" },
  "tiktok-saturated": { label: "TikTok 고채도", description: "밝고 펀치감 있는 SNS용 팔레트" },
  "youtube-vlog-flat": { label: "YouTube 브이로그 플랫", description: "깔끔한 브이로그용 플랫 그레이딩" },
  "iphone-hdr": { label: "iPhone HDR", description: "컴퓨테이셔널 HDR 룩" },
  "y2k-saturated": { label: "Y2K 고채도", description: "2000년대 초의 디지털 팝 룩" },
  "mtv-90s-vhs": { label: "MTV 90s VHS", description: "90년대 VHS의 과채도 색감" },
  "polaroid-faded": { label: "빛바랜 폴라로이드", description: "마젠타 톤으로 바랜 폴라로이드" },
  "lifestyle-warm-magazine": { label: "라이프스타일 웜 매거진", description: "모던하고 따뜻한 에디토리얼 그레이딩" },

  // Newly added
  "kodachrome-64": { description: "채도 높은 레드, 황금빛 따스함" },
  "ektachrome-100": { description: "차갑고 깔끔한 블루, 슬라이드 필름의 명료함" },
  "kodak-tri-x-400": { description: "푸시 처리로 그레인이 두드러진 흑백 보도 사진" },
  "aerochrome": { description: "초현실적인 핑크-마젠타빛 초목" },
  "fuji-instax": { description: "부드러운 파스텔 톤의 인스턴트 필름" },
  "cinestill-50d": { description: "데이라이트용 시네마 필름 스톡" },
  "expired-film": { description: "컬러 시프트와 빛샘" },
}

export default map
