import type { Film, Scheme, Settings } from '../types';
import { buildAlignment } from '../road/alignment';
import { buildSigns } from '../sim/scene';
import { vehicleState } from '../sim/vehicle';
import { signPhotometry } from '../optics/luminance';
import { buildHighBeam, buildLowBeam } from '../optics/headlamp';

export interface CurvePoint {
  distance: number; // 距标志 m
  station: number;  // 车辆里程
  E: number;        // 照度 lx
  alpha: number;    // 观测角 deg
  beta: number;     // 入射角 deg
  RA: number;       // cd/(lx·m²)
  L: number;        // cd/m²
}

/**
 * 标志亮度-距离曲线:车辆从 sign 前方 maxDist 匀速驶向标志,
 * 固定步长采样(默认 1m),全程 CPU f64 纯函数计算 ——
 * 同一方案重复计算结果逐位一致,与仿真页显示值同源。
 */
export function luminanceCurve(
  scheme: Scheme,
  films: Film[],
  settings: Settings,
  signId: string,
  maxDist = 300,
): CurvePoint[] {
  const al = buildAlignment(scheme.horiz, scheme.vpis);
  const mesh = buildSigns(scheme, al);
  const inst = mesh.instances.find((i) => i.id === signId);
  const spec = scheme.signs.find((s) => s.id === signId);
  if (!inst || !spec) return [];
  const film = films.find((f) => f.id === spec.filmId) ?? films[0];
  const table = settings.beam === 'high' ? buildHighBeam() : buildLowBeam();
  const step = Math.max(0.5, settings.reportStep);
  const pts: CurvePoint[] = [];
  for (let d = maxDist; d >= 2; d -= step) {
    const station = spec.station - d;
    if (station < 0) continue;
    const v = vehicleState(al, scheme.cross, scheme.designKmh, settings, station);
    const p = signPhotometry(table, v.lamps, v.eye, inst.center, inst.normal, film, inst.colorFactor);
    pts.push({ distance: d, station, E: p.E, alpha: p.alpha, beta: p.beta, RA: p.RA, L: p.L });
  }
  return pts;
}

export function curveToCSV(pts: CurvePoint[], signName: string): string {
  const head = `# 标志: ${signName}, 亮度单位 cd/m², 照度单位 lx`;
  const cols = '距离(m),里程(m),垂直照度E(lx),观测角α(°),入射角β(°),RA(cd/lx/m²),亮度L(cd/m²)';
  const rows = pts.map((p) =>
    [p.distance.toFixed(1), p.station.toFixed(1), p.E.toExponential(4), p.alpha.toFixed(3),
     p.beta.toFixed(2), p.RA.toFixed(1), p.L.toFixed(4)].join(','));
  return '﻿' + [head, cols, ...rows].join('\r\n');
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
