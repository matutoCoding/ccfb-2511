import type { CrossSection, Scheme } from '../types';
import { halfWidth, roadFrame, type Alignment } from '../road/alignment';
import { SIGN_COLORS, type Vec3 } from '../types';

/**
 * 场景网格构建。所有采样步长固定,网格完全确定。
 */

export interface RoadMesh {
  vertexData: Float32Array<ArrayBuffer>; // 每顶点 8 floats: pos3, normal3, station, lateral
  indices: Uint32Array<ArrayBuffer>;
  rows: number;             // 里程采样行数
  step: number;             // 里程步长 m
}

export function buildRoadMesh(al: Alignment, cross: CrossSection, designKmh: number, step = 2): RoadMesh {
  const W = halfWidth(cross);
  const rows = Math.max(2, Math.ceil(al.length / step) + 1);
  const vertexData = new Float32Array(rows * 2 * 8);
  const indices = new Uint32Array((rows - 1) * 6);
  for (let i = 0; i < rows; i++) {
    const s = Math.min(i * step, al.length);
    for (let side = 0; side < 2; side++) {
      const lat = side === 0 ? -W : W;
      const f = roadFrame(al, cross, designKmh, s, lat, 0);
      const o = (i * 2 + side) * 8;
      vertexData[o] = f.pos.x; vertexData[o + 1] = f.pos.y; vertexData[o + 2] = f.pos.z;
      vertexData[o + 3] = f.up.x; vertexData[o + 4] = f.up.y; vertexData[o + 5] = f.up.z;
      vertexData[o + 6] = s; vertexData[o + 7] = lat;
    }
    if (i < rows - 1) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      const io = i * 6;
      indices[io] = a; indices[io + 1] = b; indices[io + 2] = c;
      indices[io + 3] = b; indices[io + 4] = d; indices[io + 5] = c;
    }
  }
  return { vertexData, indices, rows, step };
}

export interface SignInstance {
  id: string;
  name: string;
  station: number;
  center: Vec3;
  normal: Vec3;
  color: [number, number, number];
  colorFactor: number;
  filmId: string;
}

export interface SignMesh {
  instances: SignInstance[];
  vertexData: Float32Array<ArrayBuffer>; // 每顶点 6 floats: pos3, uv2, signIndex
  indices: Uint32Array<ArrayBuffer>;
}

export function buildSigns(scheme: Scheme, al: Alignment): SignMesh {
  const n = scheme.signs.length;
  const vertexData = new Float32Array(n * 4 * 6);
  const indices = new Uint32Array(n * 6);
  const instances: SignInstance[] = [];
  const laneEdge = scheme.cross.laneWidth * scheme.cross.lanesPerDir;
  scheme.signs.forEach((sign, i) => {
    const latC = (laneEdge + sign.offset) * (sign.side === 'right' ? 1 : -1);
    const fc = roadFrame(al, scheme.cross, scheme.designKmh, sign.station, latC, sign.bottomHeight + sign.panelH / 2);
    // 法线:水平、迎面指向来车(与切向相反)
    const nrm = { x: -fc.tangent.x, y: 0, z: -fc.tangent.z };
    const nl = Math.hypot(nrm.x, nrm.z) || 1;
    nrm.x /= nl; nrm.z /= nl;
    // 版面局部轴:右(水平)、上(竖直)
    const right = { x: fc.right.x, y: 0, z: fc.right.z };
    const rl = Math.hypot(right.x, right.z) || 1;
    right.x /= rl; right.z /= rl;
    const hw = sign.width / 2, hh = sign.panelH / 2;
    const corners: [number, number, number, number][] = [
      [-hw, -hh, 0, 1], [hw, -hh, 1, 1], [hw, hh, 1, 0], [-hw, hh, 0, 0],
    ];
    corners.forEach(([dx, dy, u, v], k) => {
      const o = (i * 4 + k) * 6;
      vertexData[o] = fc.pos.x + right.x * dx;
      vertexData[o + 1] = fc.pos.y + dy;
      vertexData[o + 2] = fc.pos.z + right.z * dx;
      vertexData[o + 3] = u; vertexData[o + 4] = v; vertexData[o + 5] = i;
    });
    const io = i * 6, b = i * 4;
    indices[io] = b; indices[io + 1] = b + 1; indices[io + 2] = b + 2;
    indices[io + 3] = b; indices[io + 4] = b + 2; indices[io + 5] = b + 3;
    const col = SIGN_COLORS[sign.color] ?? SIGN_COLORS.white;
    instances.push({
      id: sign.id, name: sign.name, station: sign.station,
      center: fc.pos, normal: nrm, color: col.rgb, colorFactor: col.factor, filmId: sign.filmId,
    });
  });
  return { instances, vertexData, indices };
}
