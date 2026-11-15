import type { CrossSection, HorizElement, Vec3, VPI } from '../types';
import { clamp, norm } from '../math3';

/**
 * 道路几何:平面线形(直线/圆曲线/缓和曲线) + 纵断面(变坡点+抛物线竖曲线)。
 * 坐标系:X 东、Y 高程、Z 北;起点在原点,初始方位角 0(正北)。
 * 方位角 ψ 自正北顺时针(向右)为正;曲率 κ>0 表示右转。
 * 全部计算为固定步长的确定性数值过程,同一里程结果唯一。
 */

export interface AlignPoint {
  x: number; y: number; z: number; // y 为高程
  heading: number;                 // 方位角 rad
  curvature: number;               // 1/m,右转为正
}

export interface Alignment {
  length: number;
  pointAt(s: number): AlignPoint;
}

interface HState { x: number; z: number; psi: number; kappa: number; s: number }

function buildHorizontal(horiz: HorizElement[]): { length: number; at(s: number): HState } {
  // 预计算每个单元起点状态(确定性)
  interface Seg { el: HorizElement; start: HState; k0: number; k1: number }
  const segs: Seg[] = [];
  let st: HState = { x: 0, z: 0, psi: 0, kappa: 0, s: 0 };
  for (const el of horiz) {
    const k0 = st.kappa;
    let k1 = k0;
    if (el.type === 'arc') k1 = 1 / el.radius;
    else if (el.type === 'clothoid') k1 = el.radius === 0 ? 0 : 1 / el.radius;
    else k1 = 0;
    segs.push({ el, start: { ...st }, k0, k1 });
    st = advance({ ...st }, el, k0, k1, el.length);
    st.s += el.length;
  }
  const total = st.s;

  function advance(p: HState, el: HorizElement, k0: number, k1: number, ds_total: number): HState {
    if (el.type === 'straight') {
      p.x += Math.sin(p.psi) * ds_total;
      p.z += Math.cos(p.psi) * ds_total;
      p.kappa = 0;
      return p;
    }
    if (el.type === 'arc') {
      const R = el.radius;
      const dpsi = ds_total / R;
      const psi2 = p.psi + dpsi;
      // ψ 随里程线性变化,直接积分:
      // Δx = R·(cosψ1 − cosψ2), Δz = R·(sinψ2 − sinψ1)
      p.x += R * (Math.cos(p.psi) - Math.cos(psi2));
      p.z += R * (Math.sin(psi2) - Math.sin(p.psi));
      p.psi = psi2;
      p.kappa = 1 / R;
      return p;
    }
    // 缓和曲线:固定步长中点积分(步数仅由长度决定,完全确定)
    const n = Math.max(1, Math.ceil(ds_total / 0.25));
    const ds = ds_total / n;
    for (let i = 0; i < n; i++) {
      const smid = (i + 0.5) * ds;
      const kmid = k0 + ((k1 - k0) * smid) / ds_total;
      const psiMid = p.psi + (p.kappa + kmid) * 0.5 * ds;
      p.x += Math.sin(psiMid) * ds;
      p.z += Math.cos(psiMid) * ds;
      p.psi = p.psi + (p.kappa + kmid) * 0.5 * ds;
      p.kappa = kmid;
    }
    p.kappa = k1;
    return p;
  }

  function at(s: number): HState {
    const sc = clamp(s, 0, total);
    let acc = 0;
    for (const seg of segs) {
      if (sc <= acc + seg.el.length || seg === segs[segs.length - 1]) {
        const local = clamp(sc - acc, 0, seg.el.length);
        const p = { ...seg.start };
        return advance(p, seg.el, seg.k0, seg.k1, local);
      }
      acc += seg.el.length;
    }
    return { ...st };
  }

  return { length: total, at };
}

function buildVertical(vpis: VPI[]): (s: number) => number {
  const pts = [...vpis].sort((a, b) => a.station - b.station);
  if (pts.length === 0) return () => 0;
  if (pts.length === 1) return () => pts[0].elevation;
  // 各变坡点前后坡度
  const grade: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    grade.push((pts[i + 1].elevation - pts[i].elevation) / (pts[i + 1].station - pts[i].station));
  }
  return (s: number) => {
    if (s <= pts[0].station) return pts[0].elevation + (s - pts[0].station) * grade[0];
    const last = pts.length - 1;
    if (s >= pts[last].station) return pts[last].elevation + (s - pts[last].station) * grade[last - 1];
    // 查找所在区间
    let i = 0;
    while (i < last && s > pts[i + 1].station) i++;
    // 检查是否落在相邻竖曲线范围内
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      if (p.curveLength <= 0) continue;
      const half = p.curveLength / 2;
      if (s >= p.station - half && s <= p.station + half) {
        const g1 = k === 0 ? grade[0] : grade[k - 1];
        const g2 = k === last ? grade[last - 1] : grade[k];
        const x = s - (p.station - half);
        const z0 = p.elevation - g1 * half;
        return z0 + g1 * x + ((g2 - g1) * x * x) / (2 * p.curveLength);
      }
    }
    return pts[i].elevation + (s - pts[i].station) * grade[i];
  };
}

export function buildAlignment(horiz: HorizElement[], vpis: VPI[]): Alignment {
  const hz = buildHorizontal(horiz);
  const zv = buildVertical(vpis);
  return {
    length: hz.length,
    pointAt(s: number): AlignPoint {
      const p = hz.at(s);
      return { x: p.x, y: zv(s), z: p.z, heading: p.psi, curvature: p.kappa };
    },
  };
}

/** 横坡产生的横向高差(路拱/超高) */
export function crossSlopeOffset(lateral: number, curvature: number, designKmh: number): number {
  if (Math.abs(curvature) < 1e-7) {
    return -0.02 * Math.abs(lateral); // 双向路拱 2%
  }
  const R = 1 / Math.abs(curvature);
  const e = clamp((designKmh * designKmh) / (127 * R), 0.02, 0.08);
  return -e * lateral * Math.sign(curvature); // 超高:弯道内侧低
}

export interface Frame {
  pos: Vec3;      // 路中线点
  tangent: Vec3;  // 三维切向(含纵坡)
  right: Vec3;    // 三维右向(含横坡)
  up: Vec3;
  curvature: number;
}

/** 里程 s、横向偏移 lateral(右为正)、净空高 h 处的三维坐标与局部坐标架 */
export function roadFrame(
  al: Alignment,
  cross: CrossSection,
  designKmh: number,
  s: number,
  lateral: number,
  h = 0,
): Frame {
  const sc = clamp(s, 0, al.length);
  const p = al.pointAt(sc);
  // 纵坡角
  const ds = 1;
  const y1 = al.pointAt(clamp(sc - ds, 0, al.length)).y;
  const y2 = al.pointAt(clamp(sc + ds, 0, al.length)).y;
  const gradeSlope = (y2 - y1) / (Math.min(ds, al.length - sc) + Math.min(ds, sc) || 1);
  const sinH = Math.sin(p.heading), cosH = Math.cos(p.heading);
  const tangent = norm({ x: sinH, y: gradeSlope, z: cosH });
  // 横坡
  const m = lateral >= 0
    ? crossSlopeOffset(lateral + 0.5, p.curvature, designKmh) - crossSlopeOffset(lateral - 0.5, p.curvature, designKmh)
    : crossSlopeOffset(lateral - 0.5, p.curvature, designKmh) - crossSlopeOffset(lateral + 0.5, p.curvature, designKmh);
  const rightH = { x: cosH, y: 0, z: -sinH };
  const right = norm({ x: rightH.x, y: m, z: rightH.z });
  const up = norm({
    x: tangent.y * right.z - tangent.z * right.y,
    y: tangent.z * right.x - tangent.x * right.z,
    z: tangent.x * right.y - tangent.y * right.x,
  });
  const yOff = crossSlopeOffset(lateral, p.curvature, designKmh);
  const pos: Vec3 = {
    x: p.x + rightH.x * lateral,
    y: p.y + yOff + h,
    z: p.z + rightH.z * lateral,
  };
  return { pos, tangent, right, up, curvature: p.curvature };
}

/** 行车道半幅宽(不含路肩) */
export function carriageway(cross: CrossSection): number {
  return cross.laneWidth * cross.lanesPerDir;
}

/** 道路总半宽(含路肩) */
export function halfWidth(cross: CrossSection): number {
  return carriageway(cross) + cross.shoulderWidth;
}
