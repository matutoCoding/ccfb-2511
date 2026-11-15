import type { CrossSection, Settings, Vec3 } from '../types';
import { roadFrame, type Alignment } from '../road/alignment';
import type { LampGeom } from '../optics/luminance';
import { norm, sub } from '../math3';

/** 驾驶员所在车道(最右侧车道)中心横向位置 */
export function driverLaneLateral(cross: CrossSection): number {
  return (cross.lanesPerDir - 0.5) * cross.laneWidth;
}

export interface VehicleState {
  eye: Vec3;
  target: Vec3;
  gazeDir: Vec3;
  lamps: LampGeom[];
}

/** 本车状态:眼位、注视点(前方 60m 路面)、两只前灯(含姿态) */
export function vehicleState(
  al: Alignment,
  cross: CrossSection,
  designKmh: number,
  settings: Settings,
  station: number,
): VehicleState {
  const lat = driverLaneLateral(cross);
  const eyeF = roadFrame(al, cross, designKmh, station, lat, settings.eyeHeight);
  const tgtF = roadFrame(al, cross, designKmh, station + 60, lat, 0);
  const lamps: LampGeom[] = [];
  for (const side of [-1, 1]) {
    const f = roadFrame(al, cross, designKmh, station, lat + side * settings.lampLateral, settings.lampHeight);
    lamps.push({ pos: f.pos, dir: f.tangent, right: f.right, up: f.up });
  }
  return {
    eye: eyeF.pos,
    target: tgtF.pos,
    gazeDir: norm(sub(tgtF.pos, eyeF.pos)),
    lamps,
  };
}

/** 对向车状态(对向最靠其右侧的车道,即靠近中央线的对向车道) */
export function oncomingState(
  al: Alignment,
  cross: CrossSection,
  designKmh: number,
  settings: Settings,
  station: number,
): { lamps: LampGeom[]; quad: Float32Array<ArrayBuffer> } {
  const lat = -driverLaneLateral(cross);
  const lamps: LampGeom[] = [];
  const quad = new Float32Array(12 * 6);
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const f = roadFrame(al, cross, designKmh, station, lat + side * settings.lampLateral, settings.lampHeight);
    // 对向车朝反方向行驶:照射方向取切向的反方向
    const dir = { x: -f.tangent.x, y: -f.tangent.y, z: -f.tangent.z };
    const right = { x: -f.right.x, y: -f.right.y, z: -f.right.z };
    lamps.push({ pos: f.pos, dir, right, up: f.up });
    // 发光面:0.7m 见方,法线朝本车
    const hw = 0.35;
    const idx = 62 + i;
    const corners: [number, number][] = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, -hw], [hw, hw], [-hw, hw]];
    // 两个三角形(顶点顺序与标志一致即可,uv 给 0.5 避免边框效果)
    const tris: [number, number][] = [corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]];
    tris.forEach(([dx, dy], k) => {
      const o = (i * 6 + k) * 6;
      quad[o] = f.pos.x + right.x * dx;
      quad[o + 1] = f.pos.y + dy;
      quad[o + 2] = f.pos.z + right.z * dx;
      quad[o + 3] = 0.5; quad[o + 4] = 0.5; quad[o + 5] = idx;
    });
  }
  return { lamps, quad };
}
