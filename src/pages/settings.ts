import type { Ctx } from '../ui';
import { el, numInput, selectInput } from '../ui';
import { exportJson, importJson } from '../storage';
import { defaultData } from '../defaults';

/** 设置页:车辆/车灯/环境参数,数据导入导出 */
export function mountSettings(root: HTMLElement, ctx: Ctx): () => void {
  const render = () => {
    root.replaceChildren();
    const s = ctx.data.settings;

    root.append(el('div', { class: 'panel' }, [
      el('h2', {}, ['设置']),
      el('h3', {}, ['车辆与车灯']),
      el('div', { class: 'row' }, [
        '车速 km/h: ', numInput(s.speedKmh, (v) => { s.speedKmh = v; ctx.save(); }, { min: 20, max: 120, width: '70px' }),
        '驾驶员眼高 m: ', numInput(s.eyeHeight, (v) => { s.eyeHeight = v; ctx.save(); }, { step: 0.05, width: '70px' }),
        '前灯安装高 m: ', numInput(s.lampHeight, (v) => { s.lampHeight = v; ctx.save(); }, { step: 0.05, width: '70px' }),
        '前灯横向间距(单侧) m: ', numInput(s.lampLateral, (v) => { s.lampLateral = v; ctx.save(); }, { step: 0.05, width: '70px' }),
      ]),
      el('h3', {}, ['仿真默认项']),
      el('div', { class: 'row' }, [
        '车灯: ', selectInput(
          [{ value: 'low', label: '近光' }, { value: 'high', label: '远光' }] as const,
          s.beam, (v) => { s.beam = v as 'low' | 'high'; ctx.save(); },
        ),
        '路面湿滑(0干-1湿): ', numInput(s.wetness, (v) => { s.wetness = Math.min(1, Math.max(0, v)); ctx.save(); }, { step: 0.1, min: 0, max: 1, width: '70px' }),
        '报告采样步长 m: ', numInput(s.reportStep, (v) => { s.reportStep = Math.max(0.5, v); ctx.save(); }, { step: 0.5, min: 0.5, width: '70px' }),
      ]),
      el('p', { class: 'hint' }, [
        '近光灯为非对称配光(左平截止线 + 右侧 15° 上抬,峰值约 2 万 cd);远光灯峰值约 10 万 cd。',
        '配光以发光强度表 I(H,V) 存储,运行时按角度双线性插值,不是简单聚光灯。',
      ]),
    ]));

    // WebGPU 状态
    const gpuLine = el('p', { class: 'hint' }, ['正在查询 WebGPU 适配器…']);
    root.append(el('div', { class: 'panel' }, [
      el('h3', {}, ['运行环境']),
      gpuLine,
    ]));
    if (navigator.gpu) {
      navigator.gpu.requestAdapter().then((a) => {
        if (!a) { gpuLine.textContent = '未找到可用的 WebGPU 适配器'; return; }
        const info = (a as unknown as { info?: { vendor?: string; architecture?: string; description?: string } }).info;
        gpuLine.textContent = info
          ? `WebGPU 可用:${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`
          : 'WebGPU 可用';
      }).catch(() => { gpuLine.textContent = 'WebGPU 适配器查询失败'; });
    } else {
      gpuLine.textContent = '当前浏览器不支持 WebGPU';
    }

    // 数据管理
    const fileInput = el('input', {
      type: 'file', accept: '.json', style: 'display:none',
      onchange: async (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        try {
          const data = await importJson(f);
          ctx.data.schemes = data.schemes;
          ctx.data.films = data.films;
          ctx.data.settings = data.settings;
          ctx.data.activeSchemeId = data.activeSchemeId ?? data.schemes[0]?.id ?? null;
          ctx.save();
          alert('导入成功');
          render();
        } catch (err) {
          alert(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });
    root.append(el('div', { class: 'panel' }, [
      el('h3', {}, ['数据管理']),
      el('div', { class: 'row' }, [
        el('button', { class: 'primary', onclick: () => exportJson(ctx.data) }, ['导出全部数据 (JSON)']),
        el('button', { onclick: () => fileInput.click() }, ['导入数据…']),
        el('button', {
          class: 'danger',
          onclick: () => {
            if (!confirm('清空浏览器内全部方案与设置,恢复出厂数据?')) return;
            const d = defaultData();
            ctx.data.schemes = d.schemes;
            ctx.data.films = d.films;
            ctx.data.settings = d.settings;
            ctx.data.activeSchemeId = d.activeSchemeId;
            ctx.save();
            render();
          },
        }, ['恢复出厂数据']),
        fileInput,
      ]),
      el('p', { class: 'hint' }, ['所有数据仅保存在本浏览器 localStorage,导出 JSON 可备份或转移到其他电脑。']),
    ]));
  };
  render();
  return () => {};
}
