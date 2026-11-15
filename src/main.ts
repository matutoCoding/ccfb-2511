import './style.css';
import { loadData, saveData } from './storage';
import type { Ctx } from './ui';
import { el } from './ui';
import { mountRoad } from './pages/road';
import { mountSigns } from './pages/signs';
import { mountSim } from './pages/sim';
import { mountReport } from './pages/report';
import { mountSettings } from './pages/settings';

const app = document.getElementById('app')!;

function showNoWebGPU(reason: string): void {
  app.replaceChildren(el('div', { class: 'notice' }, [
    el('h2', {}, ['当前环境不支持 WebGPU,无法运行夜间仿真']),
    el('p', {}, [`检测结果:${reason}`]),
    el('p', {}, ['本系统的车灯投射与路面反光渲染依赖 WebGPU。请使用以下任一方式:']),
    el('ul', {}, [
      el('li', {}, ['Chrome / Edge 113 及以上版本(推荐,需启用硬件加速)']),
      el('li', {}, ['Safari 18 及以上版本(macOS / iOS)']),
      el('li', {}, ['Firefox 141 及以上版本(Windows)']),
    ]),
    el('p', {}, ['若浏览器版本足够但仍提示,请检查:系统显卡驱动是否过旧、是否禁用了 GPU 加速(chrome://settings/system)、或 chrome://flags 中 WebGPU 被手动关闭。']),
    el('p', { class: 'hint' }, ['道路方案、标志库、报告等数据管理功能不受影响,但本提示页为统一入口,请更换环境后刷新。']),
  ]));
}

function main(): void {
  if (!navigator.gpu) {
    showNoWebGPU('navigator.gpu 不存在(浏览器不支持 WebGPU)');
    return;
  }

  const data = loadData();
  const ctx: Ctx = {
    data,
    save: () => saveData(data),
    scheme: () => {
      const s = data.schemes.find((x) => x.id === data.activeSchemeId) ?? data.schemes[0];
      data.activeSchemeId = s.id;
      return s;
    },
  };

  const pages: Record<string, { label: string; mount: (root: HTMLElement, ctx: Ctx) => () => void; full?: boolean }> = {
    road: { label: '道路方案', mount: mountRoad },
    signs: { label: '标志库', mount: mountSigns },
    sim: { label: '夜间仿真', mount: mountSim, full: true },
    report: { label: '报告', mount: mountReport },
    settings: { label: '设置', mount: mountSettings },
  };

  let cleanup: (() => void) | null = null;

  const route = () => {
    cleanup?.();
    cleanup = null;
    const hash = location.hash.replace(/^#\/?/, '') || 'road';
    const key = hash in pages ? hash : 'road';
    const page = pages[key];

    const nav = el('nav', { class: 'topnav' }, [
      el('span', { class: 'brand' }, ['夜间视认性仿真']),
      ...Object.entries(pages).map(([k, p]) =>
        el('a', { href: `#/${k}`, ...(k === key ? { class: 'active' } : {}) }, [p.label])),
    ]);
    const main = el('main', page.full ? { class: 'full' } : {});
    app.replaceChildren(nav, main);
    cleanup = page.mount(main, ctx);
  };

  window.addEventListener('hashchange', route);
  route();
}

main();
