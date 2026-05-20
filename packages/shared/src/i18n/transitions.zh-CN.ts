import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto": { label: "自动", description: "让模型自主选择" },
  "none": { label: "硬切", description: "瞬间切换，无过渡" },
  "cross-dissolve": { label: "交叉溶解", description: "两个镜头间的渐进融合" },
  "fade-to-black": { label: "淡出至黑", description: "画面变暗至全黑，第二幕浮现" },
  "fade-to-white": { label: "淡出至白", description: "画面泛白，第二幕从白光中显现" },
  "match-cut": { label: "匹配剪辑", description: "镜头间形状或动作的视觉呼应" },
  "smash-cut": { label: "撞击剪辑", description: "对比强烈的镜头间的突兀硬切" },
  "iris": { label: "虹膜转场", description: "圆形虹膜收缩后展开至第二幕" },
  "wipe": { label: "划像", description: "直线划过替换第一个镜头" },
  "roll-transition": { label: "滚动转场", description: "画面旋转90–180°，第二幕正立落定" },
  "seamless-match": { label: "无缝匹配", description: "以运动与色调伪装的隐形剪辑" },

  // ── Time ──
  "fast-forward-day-night": { label: "快进（日→夜）", description: "同一场景日转夜的延时摄影" },
  "fast-forward-night-day": { label: "快进（夜→晨）", description: "同一场景夜转黎明的延时摄影" },
  "seasonal-shift": { label: "季节更迭", description: "同一场景四季流转" },
  "aging": { label: "岁月流逝", description: "主体明显衰老" },
  "rewind": { label: "倒带", description: "时间倒流，动作逆向播放" },
  "freeze-frame-jump": { label: "定格跳跃", description: "动作定格后跳跃至未来时刻" },
  "weather-shift": { label: "天气变换", description: "同一场景天气骤变" },
  "flashback": { label: "闪回", description: "记忆闪回，回到过去一刻" },

  // ── Element ──
  "dissolve-to-mist": { label: "化雾消散", description: "主体化为薄雾飘散后重新凝聚" },
  "water-splash": { label: "水花飞溅", description: "主体化为水流，飞溅后重新成形" },
  "sand-scatter": { label: "沙尘飞散", description: "主体化为沙粒被风吹散后重新聚合" },
  "fire-burnup": { label: "燃烬", description: "主体燃烧成余烬，余烬重新汇聚" },
  "smoke-puff": { label: "烟雾消散", description: "主体消失于烟雾，又从烟雾中显现" },
  "magic-sparkles": { label: "魔法粒子", description: "复仇者联盟风格的粒子消散" },
  "lightning-flash": { label: "雷光闪击", description: "闪电划过画面，闪光中场景切换" },
  "ink-splash": { label: "泼墨", description: "墨水铺满画面后收回，露出新场景" },
  "sand-storm": { label: "沙尘暴", description: "沙暴席卷画面，内部场景转换" },
  "paint-splash": { label: "泼彩", description: "彩漆覆盖画面后收缩，露出新场景" },
  "aurora-sweep": { label: "极光扫场", description: "极光帷幕扫过画面，场景转换" },
  "sakura-petals": { label: "樱花飞舞", description: "樱花瓣风暴横扫画面" },
  "garden-bloom": { label: "百花齐放", description: "花朵盛开向外蔓延，如帷幕揭开新场景" },
  "powder-burst": { label: "彩粉爆炸", description: "彩色粉末爆炸扩散后沉落，新场景显现" },

  // ── Morph ──
  "liquid-morph": { label: "液态变形", description: "主体液化流动，变形为新主体" },
  "pixelate-reform": { label: "像素化重组", description: "像素化后散开，重新聚合" },
  "shatter-glass": { label: "碎裂重组", description: "主体如玻璃碎裂后重新拼合" },
  "origami-fold": { label: "折纸变形", description: "主体如纸折叠变化为新形态" },
  "vortex-swirl": { label: "漩涡旋入", description: "主体旋入漩涡，展开为新形态" },
  "dream-ripple": { label: "梦境涟漪", description: "水面涟漪扩散，新场景随之显现" },
  "wireframe-morph": { label: "线框变形", description: "主体简化为线框，重构为新主体" },
  "polygon-shatter": { label: "多边形碎裂", description: "主体碎成低多边形，重新拼合为新形态" },
  "melt-down": { label: "融化重生", description: "主体熔化成水洼，升起重构为新主体" },

  // ── Portal ──
  "zoom-into-eye": { label: "推入眼睛", description: "推入瞳孔，内部是新世界" },
  "zoom-into-mirror": { label: "推入镜子", description: "推入镜面，进入反射世界" },
  "zoom-into-screen": { label: "推入屏幕", description: "推入电视/手机/显示器画面" },
  "zoom-into-book": { label: "推入书本", description: "推入书页插图，插图变为新场景" },
  "walk-through-door": { label: "穿越门洞", description: "穿过门进入全新场景" },
  "fall-into-hole": { label: "坠入洞口", description: "镜头坠落穿越开口" },
  "pull-out-reveal": { label: "拉远揭示", description: "拉远后发现第一幕只是画中画" },
  "zoom-into-mouth": { label: "推入口腔", description: "推入张开的嘴，进入内部新世界" },
  "push-through-glass": { label: "穿越玻璃", description: "镜头推过玻璃折射进入新世界" },
  "soul-jump": { label: "灵魂跃迁", description: "半透明灵魂离体，跃入新身体" },

  // ── Physics ──
  "explosion-blast": { label: "爆炸", description: "爆炸席卷画面，新场景从烟尘中浮现" },
  "shockwave": { label: "冲击波", description: "冲击波扭曲画面，场景随之转换" },
  "punch-into-camera": { label: "拳击摄像机", description: "拳头击中镜头，场景在冲击中转换" },
  "debris-shower": { label: "碎片横飞", description: "碎片扫过镜头，背后场景已换" },
  "gravity-flip": { label: "重力翻转", description: "重力反向，镜头旋转180°" },
  "building-explosion": { label: "建筑爆炸", description: "建筑爆炸，烟尘散去后场景切换" },
  "vehicle-explosion": { label: "车辆爆炸", description: "前景车辆爆炸，火焰散去后新场景" },
  "jump-match": { label: "跳跃匹配", description: "主体起跳，落地衔接新场景" },
  "hand-swipe": { label: "手掌划过", description: "手掌扫过镜头，遮挡间场景切换" },

  // ── Light ──
  "white-flash": { label: "白色闪光", description: "画面泛出纯白" },
  "lens-flare-swipe": { label: "镜头光晕扫场", description: "变形镜头光晕横扫画面" },
  "light-streak": { label: "光束扫场", description: "光束划过画面，场景转换" },
  "color-invert": { label: "颜色反转闪光", description: "颜色瞬间反转" },
  "sun-glare": { label: "阳光眩光", description: "强烈日光眩光漂白画面" },
  "lens-crack": { label: "镜头裂痕", description: "镜头开裂，透过裂纹看到新场景" },
  "dirty-lens-wipe": { label: "镜头污渍擦拭", description: "镜头污渍被擦净，场景随之更换" },
  "eye-light-burst": { label: "眼部光束爆发", description: "主体眼睛射出强光，画面白屏后新场景" },

  // ── Glitch ──
  "digital-glitch": { label: "数字故障", description: "RGB分离+扫描线+数据溶解故障" },
  "vhs-rewind": { label: "VHS倒带", description: "VHS磁带倒带式画面扭曲" },
  "datamosh": { label: "Datamosh", description: "运动向量模糊渗透场景切换" },
  "channel-flip": { label: "频道切换", description: "电视静电加频道跳转" },
  "hologram-flicker": { label: "全息闪烁", description: "全息风闪烁中新场景物化显现" },
  "display-wipe": { label: "显示屏切换", description: "场景压缩入显示屏，展开为新场景" },
  "double-exposure": { label: "双重曝光", description: "两个场景叠合，前者渐渐消融" },
}

export default map
