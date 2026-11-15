import type { AppData, Film, MarkingSpec, Scheme, Settings } from './types';

/**
 * 默认反光膜库。RA 单位 cd/(lx·m²)(白色膜),数值为各等级代表性最小值,
 * 观测角 α = 0.2°/0.5°/1.0°,入射角 β = -4°/15°/30°/40°。
 * 用户可在"标志库"页修改或新增。
 */
export function defaultFilms(): Film[] {
  const obs = [0.2, 0.5, 1.0];
  const ent = [-4, 15, 30, 40];
  const mk = (id: string, name: string, ra: number[][]): Film => ({
    id, name, obsAngles: [...obs], entAngles: [...ent], ra,
  });
  return [
    mk('film-I', 'Ⅰ类 工程级', [
      [70, 50, 30, 10],
      [30, 25, 15, 7],
      [10, 7, 5, 3],
    ]),
    mk('film-III', 'Ⅲ类 高强级', [
      [250, 210, 150, 110],
      [95, 80, 60, 45],
      [45, 35, 25, 18],
    ]),
    mk('film-IV', 'Ⅳ类 超强级', [
      [360, 300, 240, 175],
      [150, 120, 90, 65],
      [75, 60, 45, 30],
    ]),
    mk('film-IX', 'Ⅸ类 棱镜型', [
      [580, 470, 350, 260],
      [380, 300, 220, 160],
      [120, 95, 70, 50],
    ]),
    mk('film-XI', 'Ⅺ类 钻石级', [
      [830, 680, 500, 360],
      [580, 460, 340, 240],
      [200, 160, 110, 80],
    ]),
  ];
}

export const MARKING_PRESETS: MarkingSpec[] = [
  { name: '普通热熔(干燥150/潮湿25)', dryRL: 150, wetRL: 25 },
  { name: '雨夜高亮(干燥350/潮湿150)', dryRL: 350, wetRL: 150 },
  { name: '普通涂料(干燥100/潮湿15)', dryRL: 100, wetRL: 15 },
];

export function defaultScheme(): Scheme {
  return {
    id: 'scheme-demo',
    name: '示例方案(山岭区弯道)',
    designKmh: 80,
    horiz: [
      { type: 'straight', length: 200, radius: 0 },
      { type: 'clothoid', length: 70, radius: 600 },
      { type: 'arc', length: 180, radius: 600 },
      { type: 'clothoid', length: 70, radius: 0 },
      { type: 'straight', length: 260, radius: 0 },
      { type: 'clothoid', length: 60, radius: -500 },
      { type: 'arc', length: 150, radius: -500 },
      { type: 'clothoid', length: 60, radius: 0 },
      { type: 'straight', length: 300, radius: 0 },
    ],
    vpis: [
      { station: 0, elevation: 100, curveLength: 0 },
      { station: 350, elevation: 103.5, curveLength: 120 },
      { station: 750, elevation: 99.5, curveLength: 160 },
      { station: 1100, elevation: 104, curveLength: 140 },
      { station: 1400, elevation: 106, curveLength: 0 },
    ],
    cross: { laneWidth: 3.75, lanesPerDir: 1, shoulderWidth: 2.5 },
    marking: { ...MARKING_PRESETS[0] },
    signs: [
      { id: 's1', name: '急弯警告', station: 150, side: 'right', offset: 1.8, bottomHeight: 2.0, width: 1.2, panelH: 1.2, filmId: 'film-III', color: 'yellow' },
      { id: 's2', name: '限速60', station: 320, side: 'right', offset: 1.8, bottomHeight: 2.2, width: 1.0, panelH: 1.2, filmId: 'film-IV', color: 'red' },
      { id: 's3', name: '地点方向预告', station: 700, side: 'right', offset: 2.2, bottomHeight: 2.5, width: 3.0, panelH: 2.0, filmId: 'film-IV', color: 'green' },
      { id: 's4', name: '反向弯路警告', station: 760, side: 'right', offset: 1.8, bottomHeight: 2.0, width: 1.2, panelH: 1.2, filmId: 'film-III', color: 'yellow' },
      { id: 's5', name: '出口指示', station: 1150, side: 'right', offset: 2.2, bottomHeight: 2.5, width: 2.5, panelH: 1.8, filmId: 'film-XI', color: 'green' },
    ],
  };
}

export function defaultSettings(): Settings {
  return {
    speedKmh: 80,
    eyeHeight: 1.2,
    lampHeight: 0.65,
    lampLateral: 0.75,
    beam: 'low',
    wetness: 0,
    glare: true,
    exposure: 1,
    reportStep: 1,
  };
}

export function defaultData(): AppData {
  const scheme = defaultScheme();
  return {
    schemes: [scheme],
    films: defaultFilms(),
    settings: defaultSettings(),
    activeSchemeId: scheme.id,
  };
}
