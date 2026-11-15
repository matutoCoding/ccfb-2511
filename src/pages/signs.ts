import type { Ctx } from '../ui';
import { el, numInput, textInput } from '../ui';
import type { Film } from '../types';

/** 标志库页:反光膜逆反射系数表(RA,cd/(lx·m²)),按入射角/观测角查表插值 */
export function mountSigns(root: HTMLElement, ctx: Ctx): () => void {
  const render = () => {
    root.replaceChildren();
    root.append(el('div', { class: 'panel' }, [
      el('h2', {}, ['标志库 — 反光膜逆反射系数表']),
      el('p', { class: 'hint' }, [
        'RA 单位 cd/(lx·m²)(白色膜)。标志亮度按 L = RA(α,β) × 颜色系数 × E⊥ 计算,',
        'α 为观测角、β 为入射角,中间角度双线性插值。彩色版面按颜色系数折减(见道路方案页)。',
      ]),
      el('button', {
        onclick: () => {
          const f: Film = {
            id: `film-${Date.now()}`, name: '自定义膜',
            obsAngles: [0.2, 0.5, 1.0], entAngles: [-4, 15, 30, 40],
            ra: [[100, 80, 60, 40], [60, 50, 35, 25], [25, 20, 15, 10]],
          };
          ctx.data.films.push(f);
          ctx.save(); render();
        },
      }, ['+ 新增反光膜']),
    ]));

    for (const film of ctx.data.films) {
      const grid = el('table', { class: 'grid' }, [
        el('tr', {}, [
          el('th', {}, ['观测角α \\ 入射角β']),
          ...film.entAngles.map((b) => el('th', {}, [`${b}°`])),
        ]),
        ...film.obsAngles.map((a, ia) => el('tr', {}, [
          el('th', {}, [`${a}°`]),
          ...film.entAngles.map((_, ib) => el('td', {}, [
            numInput(film.ra[ia][ib], (v) => { film.ra[ia][ib] = v; ctx.save(); }, { width: '76px', step: 1 }),
          ])),
        ])),
      ]);
      root.append(el('div', { class: 'panel' }, [
        el('div', { class: 'row' }, [
          el('b', {}, ['膜名称: ']),
          textInput(film.name, (v) => { film.name = v; ctx.save(); }, '220px'),
          el('button', {
            class: 'danger',
            onclick: () => {
              const used = ctx.data.schemes.some((s) => s.signs.some((g) => g.filmId === film.id));
              if (used) { alert('该膜正在被方案中的标志使用,不能删除'); return; }
              if (!confirm(`删除「${film.name}」?`)) return;
              ctx.data.films = ctx.data.films.filter((f) => f.id !== film.id);
              ctx.save(); render();
            },
          }, ['删除']),
        ]),
        el('div', { style: 'margin-top:8px; overflow-x:auto' }, [grid]),
      ]));
    }
  };
  render();
  return () => {};
}
