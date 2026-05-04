import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "轻微震颤", description: "轻度地面晃动,悬挂物摇摆" },
  "earthquake-major": { label: "强烈地震", description: "地面开裂,瓦砾坠落" },
  "building-collapse": { label: "建筑倒塌", description: "建筑物在坍塌中粉碎" },
  "tsunami-wave": { label: "海啸巨浪", description: "高耸的水墙扑面而来" },
  "tornado": { label: "龙卷风", description: "漏斗状云接触地面" },
  "hurricane": { label: "飓风", description: "呼啸狂风折弯树木,密集雨幕" },
  "blizzard-whiteout": { label: "暴风雪致盲", description: "浓密大雪吞没视野" },
  "sandstorm": { label: "沙尘暴", description: "橙色尘墙吞噬场景" },
  "dust-storm-haboob": { label: "沙暴(哈布沙暴)", description: "高耸的沙漠尘锋" },
  "wildfire-distant": { label: "远处的野火", description: "地平线上橙色光芒和烟雾" },
  "wildfire-engulfing": { label: "吞噬性野火", description: "火焰逼近,强烈热气波纹" },
  "volcanic-eruption": { label: "火山喷发", description: "岩浆喷涌,火山灰柱" },
  "lava-flow": { label: "熔岩流", description: "炽热熔融之河缓缓爬过地面" },
  "ash-rain": { label: "降灰", description: "末日般的灰色火山灰如雪般飘落" },
  "avalanche": { label: "雪崩", description: "翻滚的雪墙沿山坡倾泻而下" },
  "hailstorm": { label: "冰雹", description: "大颗冰雹在表面弹跳" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "小型爆炸", description: "带有焦点闪光的紧凑爆炸" },
  "explosion-large": { label: "大型爆炸", description: "车辆规模的火球伴随飞散碎片" },
  "explosion-massive": { label: "巨大爆炸", description: "夷平建筑的火球与冲击波" },
  "nuclear-detonation": { label: "核爆炸", description: "蘑菇云和照亮地平线的强光" },
  "fireball-airborne": { label: "空中火球", description: "在空中翻滚的火焰球体" },
  "gas-explosion": { label: "燃气爆炸", description: "明亮的丙烷式爆燃" },
  "oil-fire": { label: "石油大火", description: "高耸油性火焰与浓密黑烟" },
  "blazing-inferno": { label: "熊熊烈焰", description: "吞噬一切的火墙" },
  "flame-burst": { label: "火焰喷发", description: "快速的定向火焰射流" },
  "ember-shower": { label: "余烬飞雨", description: "炽热橙色余烬倾泻而下" },
  "smoke-pillar": { label: "黑烟柱", description: "高耸垂直的黑烟柱" },
  "mushroom-cloud": { label: "蘑菇云", description: "经典圆顶加柱状的爆炸云" },

  // ── Electric ──
  "lightning-bolt": { label: "闪电", description: "暴风雨天空中的分叉雷击" },
  "lightning-strike-impact": { label: "落雷冲击", description: "闪电击中地面伴随光的爆炸" },
  "lightning-storm": { label: "雷暴", description: "多道同时雷击" },
  "ball-lightning": { label: "球状闪电", description: "悬浮空中的发光电浆球体" },
  "plasma-arc": { label: "等离子弧", description: "两点之间的高压连续电弧" },
  "taser-sparks": { label: "电击枪火花", description: "接触瞬间紧凑爆裂的电流放电" },
  "electric-discharge": { label: "电流放电", description: "故障设备喷出的弧光能量" },
  "transformer-blowout": { label: "变压器爆炸", description: "电线杆顶端的蓝白色爆炸" },
  "st-elmos-fire": { label: "圣艾尔摩之火", description: "金属尖端上诡异的蓝色等离子辉光" },
  "static-shock-burst": { label: "静电火花", description: "可见的小型静电火花" },

  // ── Combat ──
  "muzzle-flash": { label: "枪口闪光", description: "枪管喷出的明亮橙色闪光" },
  "gunshot-impact": { label: "弹着冲击", description: "子弹击中表面伴随碎片喷溅" },
  "bullet-trail": { label: "子弹轨迹", description: "子弹穿越空气留下的可见轨迹" },
  "sword-spark": { label: "兵刃火花", description: "金属摩擦火花的微距特写" },
  "blade-clash": { label: "刀剑相击", description: "两刃相交带来冲击波" },
  "ricochet-spark": { label: "跳弹火花", description: "子弹在金属上反弹激起火花" },
  "debris-field": { label: "碎片云", description: "凝固在空中向四周飞散的弹片" },
  "glass-shatter-airborne": { label: "空中碎裂玻璃", description: "玻璃在空中爆裂成悬浮的碎片" },
  "shockwave-ground": { label: "地面冲击波", description: "地面层级可见的扩张光环" },
  "sonic-boom": { label: "音爆", description: "超音速下的压缩空气锥" },
  "smoke-grenade": { label: "烟雾弹", description: "浓重的彩色烟雾向外蔓延" },
  "flashbang": { label: "闪光弹", description: "致盲的白色闪光爆发" },
  "blood-spray": { label: "血液飞溅", description: "电影感的血滴弧线" },
  "arrow-hit-spark": { label: "箭矢命中火花", description: "箭矢射中时迸出的小火花" },

  // ── Sci-Fi ──
  "laser-blast": { label: "激光射击", description: "明亮的相干能量光束" },
  "energy-beam": { label: "能量射线", description: "宽阔脉动的等离子能量光束" },
  "plasma-bolt": { label: "等离子弹", description: "拖着蒸汽尾迹的发光弹丸" },
  "force-field-shimmer": { label: "力场闪烁", description: "六角形图案的半透明能量屏障" },
  "force-field-impact": { label: "力场冲击", description: "弹丸击中护盾处的可见涟漪" },
  "portal-opening": { label: "传送门开启", description: "撕裂空间的能量漩涡" },
  "warp-distortion": { label: "曲速扭曲", description: "时空在物体周围弯曲" },
  "hologram-flicker": { label: "全息闪烁", description: "出现故障的半透明投影" },
  "ion-storm": { label: "离子风暴", description: "宇宙背景下噼啪作响的带电粒子场" },
  "antimatter-flash": { label: "反物质闪光", description: "撕裂现实的纯白能量爆发" },

  // ── Magic ──
  "fireball-spell": { label: "火球术", description: "手中施放的旋转火焰球体" },
  "magic-aura": { label: "魔法光环", description: "环绕人物的发光能量光晕" },
  "summoning-glyph": { label: "召唤符文", description: "地面上发光的魔法阵" },
  "lightning-magic": { label: "雷电魔法", description: "施法者双手射出的电流魔法" },
  "ice-shard-burst": { label: "冰晶爆裂", description: "向外飞散的晶状碎片" },
  "energy-rune": { label: "能量符文", description: "悬浮空中的发光奥术符号" },
  "portal-magic": { label: "魔法传送门", description: "空间中旋转的神秘门户" },
  "healing-glow": { label: "治愈光辉", description: "施法者散发出的温暖金光" },
  "dark-vortex": { label: "黑暗漩涡", description: "不祥的黑紫色旋转虚空" },
  "light-explosion": { label: "光之爆发", description: "纯白金色光辉的爆发" },
}

export default map
