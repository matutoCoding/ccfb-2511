/**
 * 确定性双线性插值(纯函数,同样输入必然同样输出)。
 * xs/ys 必须升序;超出范围时取端点值(不外推)。
 * table 按 [y][x] 组织,即 table[iy][ix]。
 */
export function bilinearTable(
  xs: number[],
  ys: number[],
  table: number[][],
  x: number,
  y: number,
): number {
  const ix = bracket(xs, x);
  const iy = bracket(ys, y);
  const x0 = xs[ix], x1 = xs[ix + 1];
  const y0 = ys[iy], y1 = ys[iy + 1];
  const tx = x1 === x0 ? 0 : clamp01((x - x0) / (x1 - x0));
  const ty = y1 === y0 ? 0 : clamp01((y - y0) / (y1 - y0));
  const c00 = table[iy][ix], c10 = table[iy][ix + 1];
  const c01 = table[iy + 1][ix], c11 = table[iy + 1][ix + 1];
  const a = c00 + (c10 - c00) * tx;
  const b = c01 + (c11 - c01) * tx;
  return a + (b - a) * ty;
}

/** 返回 i 使得 xs[i] <= x <= xs[i+1],端点处夹紧 */
function bracket(xs: number[], x: number): number {
  if (x <= xs[0]) return 0;
  const n = xs.length;
  if (x >= xs[n - 1]) return n - 2;
  // 线性扫描对 3~60 个节点足够快且完全确定
  for (let i = 0; i < n - 1; i++) {
    if (x <= xs[i + 1]) return i;
  }
  return n - 2;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
