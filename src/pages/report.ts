import type { Ctx } from '../ui';
import { el, selectInput } from '../ui';
import { curveToCSV, downloadCSV, luminanceCurve, type CurvePoint } from '../report/curve';

/** 报告页:标志亮度-距离曲线,导出 CSV / PNG */
export function mountReport(root: HTMLElement, ctx: Ctx): () => void {
  let pts: CurvePoint[] = [];
  let signName = '';
  let logScale = false;

  const chart = el('canvas', { class: 'chart-canvas', width: '1100', height: '420' }) as HTMLCanvasElement;
  const summary = el('p', { class: 'hint' }, ['尚未计算']);
  const tableWrap = el('div', { style: 'max-height:300px; overflow:auto; margin-top:12px' }, []);

  const drawChart = () => {
    const c = chart.getContext('2d');
    if (!c) return;
    const W = chart.width, H = chart.height;
    c.fillStyle = '#10131a';
    c.fillRect(0, 0, W, H);
    if (pts.length === 0) return;
    const padL = 70, padR = 20, padT = 30, padB = 46;
    const pw = W - padL - padR, ph = H - padT - padB;
    const dMax = Math.max(...pts.map((p) => p.distance));
    const lMaxRaw = Math.max(...pts.map((p) => p.L));
    const lMax = (logScale ? 1 : 1.1) * (logScale ? lMaxRaw : Math.max(1, lMaxRaw));
    const lMin = logScale ? Math.max(0.001, lMaxRaw / 1000) : 0;
    const x = (d: number) => padL + pw * (1 - d / dMax); // 距离从远(左)到近(右)
    const y = (l: number) => {
      if (logScale) {
        const t = (Math.log10(Math.max(l, lMin)) - Math.log10(lMin)) / (Math.log10(lMax) - Math.log10(lMin));
        return padT + ph * (1 - t);
      }
      return padT + ph * (1 - l / lMax);
    };
    // 网格与坐标
    c.strokeStyle = '#2c323d';
    c.fillStyle = '#8b93a1';
    c.font = '12px sans-serif';
    c.lineWidth = 1;
    const yTicks: number[] = logScale
      ? Array.from({ length: 7 }, (_, i) => Math.pow(10, Math.floor(Math.log10(lMin)) + i)).filter((v) => v >= lMin && v <= lMax)
      : Array.from({ length: 6 }, (_, i) => (lMax / 5) * i);
    for (const lv of yTicks) {
      const yy = y(lv);
      c.beginPath(); c.moveTo(padL, yy); c.lineTo(W - padR, yy); c.stroke();
      c.fillText(lv < 1 ? lv.toFixed(3) : lv.toFixed(lv < 10 ? 2 : 0), 8, yy + 4);
    }
    for (let i = 0; i <= 5; i++) {
      const dv = (dMax / 5) * i;
      const xx = x(dv);
      c.beginPath(); c.moveTo(xx, padT); c.lineTo(xx, H - padB); c.stroke();
      c.fillText(dv.toFixed(0), xx - 10, H - padB + 18);
    }
    c.fillText('亮度 L (cd/m²)', 8, 18);
    c.fillText('距标志距离 (m)', W / 2 - 40, H - 8);
    // 参考线:1 cd/m² 与 5 cd/m²
    for (const [ref, col] of [[1, '#3d6b3d'], [5, '#6b5a3d']] as const) {
      if (ref > lMin && ref < lMax) {
        c.strokeStyle = col;
        c.setLineDash([5, 4]);
        c.beginPath(); c.moveTo(padL, y(ref)); c.lineTo(W - padR, y(ref)); c.stroke();
        c.setLineDash([]);
        c.fillStyle = col;
        c.fillText(`${ref} cd/m²`, W - padR - 70, y(ref) - 4);
      }
    }
    // 曲线
    c.strokeStyle = '#4da3ff';
    c.lineWidth = 2;
    c.beginPath();
    pts.forEach((p, i) => {
      const xx = x(p.distance), yy = y(p.L);
      if (i === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy);
    });
    c.stroke();
  };

  const renderTable = () => {
    const rows = pts.filter((_, i) => i % Math.max(1, Math.round(10 / ctx.data.settings.reportStep)) === 0);
    tableWrap.replaceChildren(el('table', { class: 'grid' }, [
      el('tr', {}, ['距离(m)', 'E(lx)', 'α(°)', 'β(°)', 'RA', 'L(cd/m²)'].map((t) => el('th', {}, [t]))),
      ...rows.map((p) => el('tr', {}, [
        el('td', {}, [p.distance.toFixed(0)]),
        el('td', {}, [p.E.toExponential(2)]),
        el('td', {}, [p.alpha.toFixed(3)]),
        el('td', {}, [p.beta.toFixed(1)]),
        el('td', {}, [p.RA.toFixed(0)]),
        el('td', {}, [p.L.toFixed(3)]),
      ])),
    ]));
  };

  const compute = (signId: string) => {
    const scheme = ctx.scheme();
    const spec = scheme.signs.find((s) => s.id === signId);
    signName = spec?.name ?? '';
    pts = luminanceCurve(scheme, ctx.data.films, ctx.data.settings, signId);
    if (pts.length > 0) {
      const lMax = Math.max(...pts.map((p) => p.L));
      const at100 = pts.find((p) => Math.abs(p.distance - 100) < ctx.data.settings.reportStep);
      summary.textContent =
        `「${signName}」 峰值亮度 ${lMax.toFixed(2)} cd/m²` +
        (at100 ? `,100m 处 ${at100.L.toFixed(3)} cd/m²` : '') +
        `,采样 ${pts.length} 点(步长 ${ctx.data.settings.reportStep}m,${ctx.data.settings.beam === 'high' ? '远光' : '近光'})。` +
        '同一方案重复计算结果完全一致。';
    } else {
      summary.textContent = '无有效采样点(标志可能距路线起点太近)';
    }
    drawChart();
    renderTable();
  };

  const scheme = ctx.scheme();
  let currentSignId = scheme.signs[0]?.id ?? '';
  const signSel = selectInput(
    scheme.signs.map((s) => ({ value: s.id, label: `${s.name} (K${(s.station / 1000).toFixed(3)}+${String(Math.round(s.station % 1000)).padStart(3, '0')})` })),
    currentSignId,
    (v) => { currentSignId = v; compute(v); },
  );

  root.append(el('div', { class: 'panel' }, [
    el('h2', {}, ['视认性报告 — 标志亮度曲线']),
    el('div', { class: 'row' }, [
      '方案: ', el('b', {}, [scheme.name]), ' 标志: ', signSel,
      el('label', { class: 'hint' }, [
        el('input', {
          type: 'checkbox',
          onchange: (e) => { logScale = (e.target as HTMLInputElement).checked; drawChart(); },
        }),
        ' 对数坐标',
      ]),
      el('button', {
        class: 'primary',
        onclick: () => {
          if (pts.length === 0) return;
          downloadCSV(curveToCSV(pts, signName), `标志亮度曲线_${signName}.csv`);
        },
      }, ['导出 CSV']),
      el('button', {
        onclick: () => {
          chart.toBlob((b) => {
            if (!b) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = `标志亮度曲线_${signName}.png`;
            a.click();
            URL.revokeObjectURL(a.href);
          });
        },
      }, ['导出图片']),
      el('span', { class: 'hint' }, ['车灯/车速/湿滑等在"设置"页修改后,回到本页自动按新参数重算']),
    ]),
    summary,
    chart,
    tableWrap,
  ]));

  if (currentSignId) compute(currentSignId);
  return () => {};
}
