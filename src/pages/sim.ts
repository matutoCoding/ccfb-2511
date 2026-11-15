import type { Ctx } from '../ui';
import { el } from '../ui';
import { Renderer } from '../sim/renderer';
import { vehicleState, oncomingState } from '../sim/vehicle';
import { lampCandela, signPhotometry, veilingLuminance } from '../optics/luminance';
import { buildHighBeam, buildLowBeam } from '../optics/headlamp';

/** 夜间仿真页:驾驶员视角行驶,标志亮度实时计算(cd/m²) */
export function mountSim(root: HTMLElement, ctx: Ctx): () => void {
  const settings = ctx.data.settings;

  const canvas = el('canvas', {}) as HTMLCanvasElement;
  const hud = el('div', { class: 'sim-hud' }, []);
  const btnPlay = el('button', { class: 'primary' }, ['暂停']);
  const beamSel = el('select', {
    onchange: (e) => { settings.beam = (e.target as HTMLSelectElement).value as 'low' | 'high'; ctx.save(); },
  }, [
    el('option', { value: 'low', ...(settings.beam === 'low' ? { selected: 'selected' } : {}) }, ['近光']),
    el('option', { value: 'high', ...(settings.beam === 'high' ? { selected: 'selected' } : {}) }, ['远光']),
  ]);
  const wetRange = el('input', {
    type: 'range', min: '0', max: '1', step: '0.05', value: String(settings.wetness), style: 'width:110px',
    oninput: (e) => { settings.wetness = parseFloat((e.target as HTMLInputElement).value); ctx.save(); },
  });
  const glareChk = el('input', {
    type: 'checkbox', ...(settings.glare ? { checked: 'checked' } : {}),
    onchange: (e) => { settings.glare = (e.target as HTMLInputElement).checked; ctx.save(); },
  });
  const expRange = el('input', {
    type: 'range', min: '0.1', max: '10', step: '0.1', value: String(settings.exposure), style: 'width:90px',
    oninput: (e) => { settings.exposure = parseFloat((e.target as HTMLInputElement).value); ctx.save(); },
  });
  const speedInput = el('input', {
    type: 'number', value: String(settings.speedKmh), style: 'width:64px', min: '20', max: '120',
    onchange: (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(v)) { settings.speedKmh = Math.min(120, Math.max(20, v)); ctx.save(); }
    },
  });

  const controls = el('div', { class: 'sim-controls' }, [
    btnPlay,
    el('button', { onclick: () => { station = 0; oncomingS = 400; } }, ['回起点']),
    el('button', { onclick: () => { renderer?.setScene(ctx.scheme(), ctx.data.films); } }, ['重新加载方案']),
    el('label', {}, ['车灯 ', beamSel]),
    el('label', {}, ['车速 km/h ', speedInput]),
    el('label', {}, ['路面湿滑 ', wetRange]),
    el('label', {}, ['对向眩光 ', glareChk]),
    el('label', {}, ['曝光 ', expRange]),
  ]);
  const wrap = el('div', { class: 'sim-wrap' }, [canvas, hud, controls]);
  root.append(wrap);

  let renderer: Renderer | null = null;
  let raf = 0;
  let destroyed = false;
  let playing = true;
  let station = 0;
  let oncomingS = 400;
  let last = 0;
  let acc = 0;

  const lowBeam = buildLowBeam();
  const highBeam = buildHighBeam();

  btnPlay.addEventListener('click', () => {
    playing = !playing;
    btnPlay.textContent = playing ? '暂停' : '播放';
  });

  const ro = new ResizeObserver(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  });
  ro.observe(canvas);

  const FIXED = 1 / 60;

  const frame = (t: number) => {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (!renderer || !renderer.alignment) { last = t; return; }
    const al = renderer.alignment;
    const scheme = ctx.scheme(); // 每帧取当前方案,切换/编辑后即时生效
    const dtReal = Math.min(0.1, (t - last) / 1000);
    last = t;
    const v = settings.speedKmh / 3.6;
    if (playing) {
      acc += dtReal;
      while (acc >= FIXED) {
        acc -= FIXED;
        station += v * FIXED;
        oncomingS -= 22.2 * FIXED; // 对向车约 80 km/h
        if (station > al.length - 5) station = 0;
        if (oncomingS < station - 30) oncomingS = station + 400;
      }
    }

    const vs = vehicleState(al, scheme.cross, scheme.designKmh, settings, station);
    const table = settings.beam === 'high' ? highBeam : lowBeam;

    // 可见标志亮度(CPU 光度计算,与报告页同源)
    const insts = renderer.signInstances;
    const lums = new Float32Array(insts.length);
    let nearest: { name: string; dist: number; L: number } | null = null;
    for (let i = 0; i < insts.length; i++) {
      const inst = insts[i];
      const dist = inst.station - station;
      if (dist < -5 || dist > 400) continue;
      const spec = scheme.signs.find((s) => s.id === inst.id);
      const film = ctx.data.films.find((f) => f.id === inst.filmId) ?? ctx.data.films[0];
      if (!spec || !film) continue;
      const p = signPhotometry(table, vs.lamps, vs.eye, inst.center, inst.normal, film, inst.colorFactor);
      lums[i] = p.L;
      if (dist > 2 && (!nearest || dist < nearest.dist)) nearest = { name: inst.name, dist, L: p.L };
    }

    // 对向眩光
    let veiling = 0;
    let oncoming: { quad: Float32Array<ArrayBuffer> } | null = null;
    if (settings.glare && oncomingS > station - 5 && oncomingS < station + 600) {
      const oc = oncomingState(al, scheme.cross, scheme.designKmh, settings, oncomingS);
      oncoming = { quad: oc.quad };
      for (const lamp of oc.lamps) {
        const I = lampCandela(lowBeam, lamp, vs.eye); // 对向车近光
        veiling += veilingLuminance(vs.eye, vs.gazeDir, lamp.pos, I);
      }
    }

    renderer.renderFrame({
      eye: vs.eye, target: vs.target, lamps: vs.lamps,
      beam: settings.beam, wetness: settings.wetness, exposure: settings.exposure,
      veiling, station,
      markingRL: [scheme.marking.dryRL * 1e-3, scheme.marking.wetRL * 1e-3],
      laneWidth: scheme.cross.laneWidth, lanesPerDir: scheme.cross.lanesPerDir,
      signLums: lums, oncoming,
    });

    hud.replaceChildren();
    hud.append(
      `里程: ${station.toFixed(0)} m / ${al.length.toFixed(0)} m`, document.createElement('br'),
      `车速: ${settings.speedKmh} km/h  车灯: ${settings.beam === 'high' ? '远光' : '近光'}`, document.createElement('br'),
      nearest
        ? `前方标志: ${nearest.name}  距离 ${nearest.dist.toFixed(0)} m`
        : '前方 400m 内无标志', document.createElement('br'),
      nearest ? `标志亮度 L = ${nearest.L.toFixed(3)} cd/m²` : '—', document.createElement('br'),
      `眩光光幕亮度 Lv = ${veiling.toFixed(3)} cd/m²`,
    );
  };

  Renderer.create(canvas)
    .then((r) => {
      if (destroyed) { r.destroy(); return; }
      renderer = r;
      renderer.setScene(ctx.scheme(), ctx.data.films);
      raf = requestAnimationFrame(frame);
    })
    .catch((e: Error) => {
      const reasons: Record<string, string> = {
        NO_WEBGPU: '浏览器不支持 WebGPU(navigator.gpu 不存在)',
        NO_ADAPTER: '浏览器支持 WebGPU,但找不到可用的 GPU 适配器。请检查:显卡驱动是否过旧、浏览器是否禁用了硬件加速(chrome://settings/system)、或设备仅支持软件渲染。',
      };
      wrap.replaceChildren(el('div', { class: 'notice' }, [
        el('h2', {}, ['无法启动 WebGPU 仿真']),
        el('p', {}, [reasons[e.message] ?? `原因: ${e.message}`]),
        el('p', { class: 'hint' }, ['道路方案、标志库、报告(亮度曲线为 CPU 计算)等页面不受影响,可正常使用。']),
      ]));
    });

  return () => {
    destroyed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer?.destroy();
    renderer = null;
  };
}
