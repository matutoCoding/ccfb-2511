import type { Ctx } from '../ui';
import { el, numInput, selectInput, textInput } from '../ui';
import type { HorizElement, SignSpec, VPI } from '../types';
import { MARKING_PRESETS, defaultScheme } from '../defaults';
import { buildAlignment } from '../road/alignment';
import { SIGN_COLORS } from '../types';

/** 道路方案页:平曲线、纵坡、横断面、标线、标志布设 */
export function mountRoad(root: HTMLElement, ctx: Ctx): () => void {
  const render = () => {
    root.replaceChildren();
    const scheme = ctx.scheme();

    // ---- 方案选择 ----
    const schemeSel = selectInput(
      ctx.data.schemes.map((s) => ({ value: s.id, label: s.name })),
      scheme.id,
      (id) => { ctx.data.activeSchemeId = id; ctx.save(); render(); },
    );
    root.append(el('div', { class: 'panel' }, [
      el('h2', {}, ['道路方案']),
      el('div', { class: 'row' }, [
        '当前方案: ', schemeSel,
        el('button', {
          onclick: () => {
            const ns = defaultScheme();
            ns.id = `scheme-${Date.now()}`;
            ns.name = `新方案 ${ctx.data.schemes.length + 1}`;
            ctx.data.schemes.push(ns);
            ctx.data.activeSchemeId = ns.id;
            ctx.save(); render();
          },
        }, ['新建方案']),
        el('button', {
          class: 'danger',
          onclick: () => {
            if (ctx.data.schemes.length <= 1) { alert('至少保留一个方案'); return; }
            if (!confirm(`删除方案「${scheme.name}」?`)) return;
            ctx.data.schemes = ctx.data.schemes.filter((s) => s.id !== scheme.id);
            ctx.data.activeSchemeId = ctx.data.schemes[0].id;
            ctx.save(); render();
          },
        }, ['删除方案']),
        '方案名称: ', textInput(scheme.name, (v) => { scheme.name = v; ctx.save(); }),
        '设计速度 km/h: ', numInput(scheme.designKmh, (v) => { scheme.designKmh = v; ctx.save(); }, { width: '70px' }),
      ]),
      el('p', { class: 'hint' }, [`路线全长: ${buildAlignment(scheme.horiz, scheme.vpis).length.toFixed(1)} m。数据自动保存在浏览器本地,可在"设置"页导出/导入。`]),
    ]));

    // ---- 平面线形 ----
    const horizTable = el('table', { class: 'grid' }, [
      el('tr', {}, ['类型', '长度 (m)', '半径 (m,右正左负,缓和曲线为终点半径,0=接直线)', ''].map((t) => el('th', {}, [t]))),
      ...scheme.horiz.map((h, i) => el('tr', {}, [
        el('td', {}, [selectInput(
          [{ value: 'straight', label: '直线' }, { value: 'clothoid', label: '缓和曲线' }, { value: 'arc', label: '圆曲线' }] as const,
          h.type,
          (v) => { h.type = v as HorizElement['type']; ctx.save(); render(); },
        )]),
        el('td', {}, [numInput(h.length, (v) => { h.length = v; ctx.save(); }, { min: 1 })]),
        el('td', {}, [h.type === 'straight' ? '—' : numInput(h.radius, (v) => { h.radius = v; ctx.save(); })]),
        el('td', {}, [el('button', {
          class: 'danger',
          onclick: () => { scheme.horiz.splice(i, 1); ctx.save(); render(); },
        }, ['删除'])]),
      ])),
    ]);
    root.append(el('div', { class: 'panel' }, [
      el('h3', {}, ['平面线形(按顺序拼接)']),
      horizTable,
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('button', { onclick: () => { scheme.horiz.push({ type: 'straight', length: 100, radius: 0 }); ctx.save(); render(); } }, ['+ 直线']),
        el('button', { onclick: () => { scheme.horiz.push({ type: 'clothoid', length: 60, radius: 500 }); ctx.save(); render(); } }, ['+ 缓和曲线']),
        el('button', { onclick: () => { scheme.horiz.push({ type: 'arc', length: 100, radius: 500 }); ctx.save(); render(); } }, ['+ 圆曲线']),
      ]),
    ]));

    // ---- 纵断面 ----
    const vpiTable = el('table', { class: 'grid' }, [
      el('tr', {}, ['里程 (m)', '高程 (m)', '竖曲线长 (m,0=不设)', ''].map((t) => el('th', {}, [t]))),
      ...scheme.vpis.map((p, i) => el('tr', {}, [
        el('td', {}, [numInput(p.station, (v) => { p.station = v; ctx.save(); }, { min: 0 })]),
        el('td', {}, [numInput(p.elevation, (v) => { p.elevation = v; ctx.save(); }, { step: 0.1 })]),
        el('td', {}, [numInput(p.curveLength, (v) => { p.curveLength = v; ctx.save(); }, { min: 0 })]),
        el('td', {}, [el('button', { class: 'danger', onclick: () => { scheme.vpis.splice(i, 1); ctx.save(); render(); } }, ['删除'])]),
      ])),
    ]);
    root.append(el('div', { class: 'panel' }, [
      el('h3', {}, ['纵断面(变坡点 + 抛物线竖曲线)']),
      vpiTable,
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('button', {
          onclick: () => {
            const last = scheme.vpis[scheme.vpis.length - 1];
            scheme.vpis.push({ station: (last?.station ?? 0) + 300, elevation: last?.elevation ?? 100, curveLength: 0 } as VPI);
            ctx.save(); render();
          },
        }, ['+ 变坡点']),
      ]),
    ]));

    // ---- 横断面与标线 ----
    const c = scheme.cross;
    root.append(el('div', { class: 'panel' }, [
      el('h3', {}, ['横断面与标线']),
      el('div', { class: 'row' }, [
        '车道宽 m: ', numInput(c.laneWidth, (v) => { c.laneWidth = v; ctx.save(); }, { step: 0.25, width: '70px' }),
        '单向车道数: ', numInput(c.lanesPerDir, (v) => { c.lanesPerDir = Math.max(1, Math.round(v)); ctx.save(); }, { min: 1, max: 4, width: '60px' }),
        '硬路肩宽 m: ', numInput(c.shoulderWidth, (v) => { c.shoulderWidth = v; ctx.save(); }, { step: 0.25, width: '70px' }),
      ]),
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        '标线类型: ',
        selectInput(
          MARKING_PRESETS.map((m) => ({ value: m.name, label: `${m.name}(干燥RL=${m.dryRL}/潮湿RL=${m.wetRL} mcd/m²/lx)` })),
          scheme.marking.name,
          (v) => {
            const p = MARKING_PRESETS.find((m) => m.name === v);
            if (p) scheme.marking = { ...p };
            ctx.save(); render();
          },
        ),
        '干燥 RL: ', numInput(scheme.marking.dryRL, (v) => { scheme.marking.dryRL = v; scheme.marking.name = '自定义'; ctx.save(); render(); }, { width: '80px' }),
        '潮湿 RL: ', numInput(scheme.marking.wetRL, (v) => { scheme.marking.wetRL = v; scheme.marking.name = '自定义'; ctx.save(); render(); }, { width: '80px' }),
        el('span', { class: 'hint' }, ['RL 单位 mcd/(m²·lx),雨天湿滑时按湿滑程度内插']),
      ]),
    ]));

    // ---- 标志布设 ----
    const filmOpts = ctx.data.films.map((f) => ({ value: f.id, label: f.name }));
    const colorOpts = Object.entries(SIGN_COLORS).map(([k, v]) => ({ value: k, label: v.label }));
    const signTable = el('table', { class: 'grid' }, [
      el('tr', {}, ['名称', '里程(m)', '侧向', '距边缘线(m)', '下缘高(m)', '版面宽(m)', '版面高(m)', '反光膜', '底色', ''].map((t) => el('th', {}, [t]))),
      ...scheme.signs.map((s, i) => el('tr', {}, [
        el('td', {}, [textInput(s.name, (v) => { s.name = v; ctx.save(); }, '100px')]),
        el('td', {}, [numInput(s.station, (v) => { s.station = v; ctx.save(); }, { width: '80px' })]),
        el('td', {}, [selectInput([{ value: 'right', label: '右侧' }, { value: 'left', label: '左侧' }] as const, s.side, (v) => { s.side = v as SignSpec['side']; ctx.save(); })]),
        el('td', {}, [numInput(s.offset, (v) => { s.offset = v; ctx.save(); }, { step: 0.1, width: '70px' })]),
        el('td', {}, [numInput(s.bottomHeight, (v) => { s.bottomHeight = v; ctx.save(); }, { step: 0.1, width: '70px' })]),
        el('td', {}, [numInput(s.width, (v) => { s.width = v; ctx.save(); }, { step: 0.1, width: '70px' })]),
        el('td', {}, [numInput(s.panelH, (v) => { s.panelH = v; ctx.save(); }, { step: 0.1, width: '70px' })]),
        el('td', {}, [selectInput(filmOpts, s.filmId, (v) => { s.filmId = v; ctx.save(); })]),
        el('td', {}, [selectInput(colorOpts, s.color, (v) => { s.color = v; ctx.save(); })]),
        el('td', {}, [el('button', { class: 'danger', onclick: () => { scheme.signs.splice(i, 1); ctx.save(); render(); } }, ['删除'])]),
      ])),
    ]);
    root.append(el('div', { class: 'panel' }, [
      el('h3', {}, ['标志布设']),
      signTable,
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('button', {
          onclick: () => {
            scheme.signs.push({
              id: `s-${Date.now()}`, name: '新标志', station: 100, side: 'right',
              offset: 1.8, bottomHeight: 2.0, width: 1.2, panelH: 1.2,
              filmId: ctx.data.films[0]?.id ?? '', color: 'yellow',
            });
            ctx.save(); render();
          },
        }, ['+ 标志']),
        el('span', { class: 'hint' }, ['侧向偏移为边缘线到版面中心的横向距离;反光膜在"标志库"页维护']),
      ]),
    ]));
  };
  render();
  return () => {};
}
