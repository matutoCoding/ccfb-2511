import type { Film, Vec3 } from '../types';
import { clamp, deg, dot, len, norm, sub } from '../math3';
import { bilinearTable } from './interp';
import { sampleCandela, type CandelaTable } from './headlamp';

/** 灯的几何:位置 + 正交基(照射方向 dir、右 right、上 up) */
export interface LampGeom { pos: Vec3; dir: Vec3; right: Vec3; up: Vec3 }

export interface SignPhotometry {
  E: number;      // 标志处垂直照度 E⊥ (lx)
  alpha: number;  // 观测角 (deg)
  beta: number;   // 入射角 (deg)
  RA: number;     // 逆反射系数 cd/(lx·m²)
  L: number;      // 亮度 cd/m²
}

/** 灯到目标点的发光强度:把目标方向换算到灯坐标系(H右正,V上正),查配光表 */
export function lampCandela(table: CandelaTable, lamp: LampGeom, target: Vec3): number {
  const v = sub(target, lamp.pos);
  const f = dot(v, lamp.dir);
  if (f <= 0) return 0; // 灯后无投射
  const h = deg(Math.atan2(dot(v, lamp.right), f));
  const vv = deg(Math.atan2(dot(v, lamp.up), f));
  return sampleCandela(table, h, vv);
}

/**
 * 逆反射标志光度计算(核心公式):
 *   E⊥ = Σ I_i / d_i²          垂直于光线方向的照度 (lx)
 *   L  = RA(α, β) · c · E⊥     亮度 (cd/m²)
 * 其中 RA 单位 cd/(lx·m²),c 为版面颜色系数。
 * α 取"灯中点→标志"与"标志→眼"夹角;β 取光线方向与版面法线夹角。
 * 全部为 f64 纯函数计算:同一位置重复计算结果完全一致。
 */
export function signPhotometry(
  table: CandelaTable,
  lamps: LampGeom[],
  eye: Vec3,
  center: Vec3,
  normal: Vec3,
  film: Film,
  colorFactor: number,
): SignPhotometry {
  let E = 0;
  const mid: Vec3 = { x: 0, y: 0, z: 0 };
  for (const lamp of lamps) {
    const d = len(sub(center, lamp.pos));
    if (d > 1e-6) E += lampCandela(table, lamp, center) / (d * d);
    mid.x += lamp.pos.x / lamps.length;
    mid.y += lamp.pos.y / lamps.length;
    mid.z += lamp.pos.z / lamps.length;
  }
  // 观测角α、入射角β:均以"自标志指出"的向量定义
  const toLamp = norm(sub(mid, center)); // 标志→灯中点
  const toEye = norm(sub(eye, center));  // 标志→眼
  const alpha = deg(Math.acos(clamp(dot(toLamp, toEye), -1, 1)));
  const beta = deg(Math.acos(clamp(dot(toLamp, normal), -1, 1)));
  // 表按 ra[观测角][入射角] 组织,即 x=入射角β、y=观测角α
  const RA = bilinearTable(film.entAngles, film.obsAngles, film.ra, beta, alpha);
  return { E, alpha, beta, RA, L: RA * colorFactor * E };
}

/**
 * 对向车灯失能眩光产生的等效光幕亮度(CIE 146):
 *   Lv = k · E眼 / θ²   (k=10,θ 单位度,2°~30° 近似成立)
 */
export function veilingLuminance(
  eye: Vec3,
  gazeDir: Vec3,
  glareSrc: Vec3,
  intensityCd: number,
): number {
  const v = sub(glareSrc, eye);
  const d = len(v);
  if (d < 1) return 0;
  const cosT = clamp(dot(norm(v), gazeDir), -1, 1);
  const theta = Math.max(0.5, deg(Math.acos(cosT)));
  const Eeye = intensityCd / (d * d);
  return (10 * Eeye) / (theta * theta);
}

/** 标线亮度: L = RL · E面,RL 由 mcd 换算为 cd(×1e-3);E面 为路面水平照度 */
export function markingLuminance(RLmcd: number, Esurface: number): number {
  return RLmcd * 1e-3 * Esurface;
}
