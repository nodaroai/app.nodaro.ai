import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Palette
  "warm": { label: "웜", description: "따뜻한 주황/빨강 톤입니다" },
  "cool": { label: "쿨", description: "차가운 파랑/틸 톤입니다" },
  "teal-orange": { label: "틸 & 오렌지", description: "할리우드 스타일의 보색 그레이드입니다" },
  "split-toning": { label: "스플릿 토닝", description: "차가운 섀도우, 따뜻한 하이라이트입니다" },
  "selective-color": { label: "선택 컬러", description: "흑백에 한 가지 액센트 컬러를 더한 스타일입니다" },
  "faded-matte": { label: "페이디드 매트", description: "리프트된 블랙과 뿌연 저대비입니다" },
  "log-flat": { label: "Log 플랫", description: "그레이딩 전 S-Log/V-Log 중성입니다" },
  "desaturated": { label: "디새추레이티드", description: "낮은 채도의 차분한 톤입니다" },
  "monochrome-bw": { label: "모노크롬 흑백", description: "완전한 흑백입니다" },
  "sepia": { label: "세피아", description: "빈티지한 갈색 톤입니다" },
  "pastel": { label: "파스텔", description: "부드럽고 저대비의 파스텔입니다" },
  "high-contrast": { label: "하이 콘트라스트", description: "쨍한 대비와 깊은 블랙입니다" },
  "vibrant": { label: "바이브런트", description: "고채도의 화려한 컬러입니다" },

  // Film emulation (mostly product names — keep in English)
  "kodak-portra": { description: "부드러운 피부톤과 미세한 그레인입니다" },
  "kodak-ektar": { description: "고채도와 미세한 그레인입니다" },
  "kodak-vision3": { description: "시네마 영화 필름 스톡입니다" },
  "fuji-pro-400h": { description: "파스텔 톤의 그린과 하늘입니다" },
  "cinestill-800t": { description: "텅스텐 필름의 레드 헐레이션이 특징입니다" },
  "bleach-bypass": { label: "블리치 바이패스", description: "고대비, 저채도의 룩입니다" },
  "technicolor": { label: "Technicolor 3-strip", description: "선명한 레트로 테크니컬러 룩입니다" },
  "two-strip-technicolor": { label: "Two-Strip Technicolor", description: "1920~30년대의 레드-블루 테크니컬러입니다" },
  "eastman-color": { description: "1950/60년대의 따뜻하고 바랜 필름 스톡입니다" },
  "hand-tinted": { label: "핸드 틴티드", description: "흑백 위에 손으로 칠한 컬러입니다" },
  "agfa-orwo": { description: "동유럽 스타일의 차가운 그린 톤입니다" },
  "day-for-night": { label: "데이 포 나이트", description: "낮을 밤처럼 그레이딩한 룩입니다" },
  "cross-processed": { label: "크로스 프로세스", description: "xpro로 인한 컬러 시프트입니다" },

  // Social-preset
  "instagram-warm": { label: "Instagram 웜", description: "Valencia 스타일의 따뜻한 필터입니다" },
  "tiktok-saturated": { label: "TikTok 새추레이티드", description: "밝고 펀치감 있는 소셜 팔레트입니다" },
  "youtube-vlog-flat": { label: "YouTube 블로그 플랫", description: "깨끗한 블로그 플랫 그레이드입니다" },
  "iphone-hdr": { label: "iPhone HDR", description: "컴퓨테이셔널 HDR 룩입니다" },
  "y2k-saturated": { label: "Y2K 새추레이티드", description: "2000년대 초의 디지털 팝 룩입니다" },
  "mtv-90s-vhs": { label: "MTV 90s VHS", description: "90년대 VHS의 과채도 색감입니다" },
  "polaroid-faded": { label: "폴라로이드 페이디드", description: "마젠타 톤의 바랜 폴라로이드입니다" },
  "lifestyle-warm-magazine": { label: "라이프스타일 웜 매거진", description: "모던한 따뜻한 에디토리얼 그레이드입니다" },
}

export default map
