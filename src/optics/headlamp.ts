import { rad } from '../math3';

/**
 * 前照灯配光表:发光强度 I(水平角H, 垂直角V),单位 cd。
 * H: 右为正;V: 上为正。运行期只做查表+双线性插值,不是简单聚光灯。
 * 表格由确定性函数生成(同一参数每次生成完全一致)。
 */
export interface CandelaTable {
  hMin: number; hStep: number; hCount: number;
  vMin: number; vStep: number; vCount: number;
  /** 行主序 data[vIndex * hCount + hIndex] */
  data: Float32Array<ArrayBuffer>;
}

const H_MIN = -30, H_MAX = 30, H_STEP = 1;
const V_MIN = -10, V_MAX = 6, V_STEP = 0.5;

function makeGrid(): CandelaTable {
  const hCount = Math.round((H_MAX - H_MIN) / H_STEP) + 1;
  const vCount = Math.round((V_MAX - V_MIN) / V_STEP) + 1;
  return {
    hMin: H_MIN, hStep: H_STEP, hCount,
    vMin: V_MIN, vStep: V_STEP, vCount,
    data: new Float32Array(hCount * vCount),
  };
}

const g2 = (x: number, s: number): number => Math.exp(-(x / s) * (x / s));

/**
 * 近光灯(右侧通行,单灯):非对称配光,带明显截止线。
 * 左侧截止线水平(-0.57°,即 1% 下倾),右侧 15° 上抬;
 * 热点在截止线下方约 1.2°、略偏右,峰值约 20000 cd;
 * 截止线上方仅留少量余光(防眩),近场补光照亮车前路面。
 */
export function buildLowBeam(): CandelaTable {
  const t = makeGrid();
  const tan15 = Math.tan(rad(15));
  for (let iv = 0; iv < t.vCount; iv++) {
    const v = t.vMin + iv * t.vStep;
    for (let ih = 0; ih < t.hCount; ih++) {
      const h = t.hMin + ih * t.hStep;
      const cutoff = h < 0.75 ? -0.57 : -0.57 + (h - 0.75) * tan15;
      // 水平方向展布
      const spreadH = 20000 * g2(h, 5) + 4000 * g2(h, 12) + 800 * g2(h, 25);
      // 垂直方向:峰值在截止线下方 ~1.2°
      const below = cutoff - v;
      const vertProf = g2(below - 1.2, 2.2);
      // 截止线锐化(逻辑斯蒂)
      const mask = 1 / (1 + Math.exp((v - cutoff) * 6));
      let I = spreadH * vertProf * mask;
      // 截止线上方残余(限制眩光)
      I += 250 * g2(h, 8) * (1 - mask) * g2(v - cutoff, 1.5);
      // 近场路面补光
      I += 2500 * g2(h, 20) * g2(v + 7, 3.5);
      t.data[iv * t.hCount + ih] = I;
    }
  }
  return t;
}

/**
 * 远光灯(单灯):中心强聚光 + 宽展布,峰值约 100000 cd。
 */
export function buildHighBeam(): CandelaTable {
  const t = makeGrid();
  for (let iv = 0; iv < t.vCount; iv++) {
    const v = t.vMin + iv * t.vStep;
    for (let ih = 0; ih < t.hCount; ih++) {
      const h = t.hMin + ih * t.hStep;
      let I = 80000 * g2(h, 3.5) * g2(v, 2);
      I += 20000 * g2(h, 9) * g2(v + 0.5, 4);
      I += 3000 * g2(h, 22) * g2(v + 3, 5);
      t.data[iv * t.hCount + ih] = I;
    }
  }
  return t;
}

/** 查表 + 双线性插值,角度单位度;超出配光范围视为无光(返回 0) */
export function sampleCandela(t: CandelaTable, hDeg: number, vDeg: number): number {
  if (hDeg < t.hMin || hDeg > t.hMin + (t.hCount - 1) * t.hStep) return 0;
  if (vDeg < t.vMin || vDeg > t.vMin + (t.vCount - 1) * t.vStep) return 0;
  const fh = (hDeg - t.hMin) / t.hStep;
  const fv = (vDeg - t.vMin) / t.vStep;
  const ih = Math.min(t.hCount - 2, Math.max(0, Math.floor(fh)));
  const iv = Math.min(t.vCount - 2, Math.max(0, Math.floor(fv)));
  const th = Math.min(1, Math.max(0, fh - ih));
  const tv = Math.min(1, Math.max(0, fv - iv));
  const d = t.data;
  const i00 = d[iv * t.hCount + ih];
  const i10 = d[iv * t.hCount + ih + 1];
  const i01 = d[(iv + 1) * t.hCount + ih];
  const i11 = d[(iv + 1) * t.hCount + ih + 1];
  const a = i00 + (i10 - i00) * th;
  const b = i01 + (i11 - i01) * th;
  return a + (b - a) * tv;
}
