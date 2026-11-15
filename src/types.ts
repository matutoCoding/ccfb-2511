// ---------- 基础数据模型 ----------

export interface Vec3 { x: number; y: number; z: number }

/** 平面线形单元。radius: 圆弧为带符号半径(右转为正); 缓和曲线为终点半径(0 表示接直线/无穷大) */
export interface HorizElement {
  type: 'straight' | 'arc' | 'clothoid';
  length: number;   // m
  radius: number;   // m
}

/** 纵断面变坡点 */
export interface VPI { station: number; elevation: number; curveLength: number }

export interface CrossSection {
  laneWidth: number;      // 单车道宽 m
  lanesPerDir: number;    // 单向车道数
  shoulderWidth: number;  // 单侧硬路肩宽 m
}

/** 标志设置。offset: 自边缘线到标志版面中心的横向距离(m); bottomHeight: 版面下缘离地高度(m) */
export interface SignSpec {
  id: string;
  name: string;
  station: number;
  side: 'right' | 'left';
  offset: number;
  bottomHeight: number;
  width: number;
  panelH: number;
  filmId: string;
  color: string; // SIGN_COLORS 的 key
}

/** 反光膜:逆反射系数 RA 表,单位 cd/(lx·m²),白色膜 */
export interface Film {
  id: string;
  name: string;
  obsAngles: number[]; // 观测角 α (deg)
  entAngles: number[]; // 入射角 β (deg)
  ra: number[][];      // ra[obs][ent]
}

/** 标线逆反射亮度系数 RL,单位 mcd/(m²·lx) */
export interface MarkingSpec { name: string; dryRL: number; wetRL: number }

export interface Scheme {
  id: string;
  name: string;
  designKmh: number;
  horiz: HorizElement[];
  vpis: VPI[];
  cross: CrossSection;
  marking: MarkingSpec;
  signs: SignSpec[];
}

export interface Settings {
  speedKmh: number;
  eyeHeight: number;    // 驾驶员眼高 m
  lampHeight: number;   // 前灯安装高 m
  lampLateral: number;  // 前灯距车辆中线横向距离 m(单侧)
  beam: 'low' | 'high';
  wetness: number;      // 0=干燥 1=雨天潮湿
  glare: boolean;       // 对向车眩光
  exposure: number;     // 画面曝光倍率
  reportStep: number;   // 报告采样步长 m
}

export interface AppData {
  schemes: Scheme[];
  films: Film[];
  settings: Settings;
  activeSchemeId: string | null;
}

/** 版面颜色对白色反光膜 RA 的折减系数及显示色 */
export const SIGN_COLORS: Record<string, { label: string; factor: number; rgb: [number, number, number] }> = {
  white:  { label: '白', factor: 1.00, rgb: [0.92, 0.92, 0.90] },
  yellow: { label: '黄', factor: 0.62, rgb: [0.95, 0.78, 0.10] },
  red:    { label: '红', factor: 0.15, rgb: [0.80, 0.10, 0.08] },
  green:  { label: '绿', factor: 0.12, rgb: [0.05, 0.45, 0.20] },
  blue:   { label: '蓝', factor: 0.05, rgb: [0.10, 0.25, 0.75] },
  orange: { label: '橙', factor: 0.25, rgb: [0.95, 0.45, 0.05] },
  black:  { label: '黑', factor: 0.03, rgb: [0.05, 0.05, 0.05] },
};
