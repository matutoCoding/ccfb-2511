/**
 * WGSL 着色器。配光以 candela 纹理查表(手动双线性,确定性),
 * 路面/标线/标志亮度单位均为 cd/m²,经对数色调映射显示。
 */

export const TONE_WGSL = /* wgsl */ `
fn toneMap(L: f32, exposure: f32) -> f32 {
  let l = max(L * exposure, 1e-6);
  // 显示范围 1e-4 .. 1e3 cd/m²
  let t = clamp((log2(l) + 13.2877) / 23.2535, 0.0, 1.0);
  return pow(t, 0.4545);
}
`;

export const ROAD_WGSL = /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  eye_wet: vec4f,
  lampPos: array<vec4f, 2>,
  lampDir: array<vec4f, 2>,
  lampRight: array<vec4f, 2>,
  lampUp: array<vec4f, 2>,
  params1: vec4f, // laneWidth, lanesPerDir, RL_dry(cd/m²/lx), RL_wet
  params2: vec4f, // veilingLv, exposure, rhoDry, rhoWet
  params3: vec4f, // hMin, hStep, vMin, vStep
  params4: vec4f, // hCount, vCount, beam(0近光/1远光), unused
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var lowTex: texture_2d<f32>;
@group(0) @binding(2) var highTex: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) station: f32,
  @location(3) lateral: f32,
};

@vertex
fn vs(@location(0) pos: vec3f, @location(1) nrm: vec3f,
      @location(2) station: f32, @location(3) lateral: f32) -> VOut {
  var o: VOut;
  o.pos = u.viewProj * vec4f(pos, 1.0);
  o.world = pos;
  o.normal = nrm;
  o.station = station;
  o.lateral = lateral;
  return o;
}

fn candela(h: f32, v: f32) -> f32 {
  let fh = clamp((h - u.params3.x) / u.params3.y, 0.0, u.params4.x - 1.001);
  let fv = clamp((v - u.params3.z) / u.params3.w, 0.0, u.params4.y - 1.001);
  let ih = u32(floor(fh)); let iv = u32(floor(fv));
  let th = fract(fh); let tv = fract(fv);
  var c00: f32; var c10: f32; var c01: f32; var c11: f32;
  if (u.params4.z < 0.5) {
    c00 = textureLoad(lowTex, vec2u(ih, iv), 0).r;
    c10 = textureLoad(lowTex, vec2u(ih + 1u, iv), 0).r;
    c01 = textureLoad(lowTex, vec2u(ih, iv + 1u), 0).r;
    c11 = textureLoad(lowTex, vec2u(ih + 1u, iv + 1u), 0).r;
  } else {
    c00 = textureLoad(highTex, vec2u(ih, iv), 0).r;
    c10 = textureLoad(highTex, vec2u(ih + 1u, iv), 0).r;
    c01 = textureLoad(highTex, vec2u(ih, iv + 1u), 0).r;
    c11 = textureLoad(highTex, vec2u(ih + 1u, iv + 1u), 0).r;
  }
  return mix(mix(c00, c10, th), mix(c01, c11, th), tv);
}

fn lampAngles(lampIdx: u32, target: vec3f) -> vec2f {
  let v = target - u.lampPos[lampIdx].xyz;
  let f = dot(v, u.lampDir[lampIdx].xyz);
  let h = degrees(atan2(dot(v, u.lampRight[lampIdx].xyz), f));
  let vv = degrees(atan2(dot(v, u.lampUp[lampIdx].xyz), f));
  return vec2f(h, vv);
}

${TONE_WGSL}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let N = normalize(in.normal);
  let eye = u.eye_wet.xyz;
  let wet = u.eye_wet.w;
  // 两个前灯照度
  var Eperp = 0.0;   // 垂直于光线的照度
  var Esurf = 0.0;   // 路面水平照度
  var spec = 0.0;
  let viewDir = normalize(eye - in.world);
  for (var i = 0u; i < 2u; i++) {
    let toFrag = in.world - u.lampPos[i].xyz;
    let d = length(toFrag);
    if (d < 0.5) { continue; }
    let ang = lampAngles(i, in.world);
    let I = candela(ang.x, ang.y);
    let e = I / (d * d);
    Eperp += e;
    let ldir = toFrag / d;
    let cosI = max(dot(-ldir, N), 0.0);
    Esurf += e * cosI;
    // 湿路镜面反射(朝车灯方向的亮带)
    let refl = reflect(ldir, N);
    spec += e * pow(max(dot(refl, viewDir), 0.0), 30.0);
  }
  // 标线掩膜
  let laneW = u.params1.x;
  let lanes = u.params1.y;
  let cw = laneW * lanes;
  let aLat = abs(in.lateral);
  var isMark = 0.0;
  var markHue = vec3f(1.0, 1.0, 1.0);
  var markFactor = 1.0;
  if (aLat < 0.15) { // 中央双黄线
    isMark = 1.0; markHue = vec3f(1.0, 0.8, 0.15); markFactor = 0.6;
  }
  if (abs(aLat - cw) < 0.1) { // 边缘线(实线)
    isMark = 1.0; markHue = vec3f(1.0); markFactor = 1.0;
  }
  for (var k = 1u; k < 4u; k++) { // 车道分界线(6-9 虚线)
    if (f32(k) < lanes) {
      let c = f32(k) * laneW;
      if (abs(aLat - c) < 0.075 && fract(in.station / 9.0) < 0.6667) {
        isMark = 1.0; markHue = vec3f(1.0); markFactor = 1.0;
      }
    }
  }
  let RL = mix(u.params1.z, u.params1.w, wet); // cd/m²/lx
  let rho = mix(u.params2.z, u.params2.w, wet);
  var L = 0.0;
  var hue = vec3f(0.85, 0.87, 0.95); // 沥青偏冷色
  if (isMark > 0.5) {
    L = RL * markFactor * Esurf;
    hue = markHue;
  } else {
    L = rho * Esurf / 3.14159 + spec * wet * 0.5;
  }
  L += u.params2.x; // 眩光光幕亮度
  let t = toneMap(L, u.params2.y);
  return vec4f(hue * t, 1.0);
}
`;

export const SIGN_WGSL = /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  signs: array<vec4f, 64>, // rgb=版面色相, a=亮度 cd/m²(CPU 计算)
  params: vec4f,           // veilingLv, exposure, unused, unused
};

@group(0) @binding(0) var<uniform> u: U;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) idx: f32,
};

@vertex
fn vs(@location(0) pos: vec3f, @location(1) uv: vec2f, @location(2) idx: f32) -> VOut {
  var o: VOut;
  o.pos = u.viewProj * vec4f(pos, 1.0);
  o.uv = uv;
  o.idx = idx;
  return o;
}

${TONE_WGSL}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let s = u.signs[u32(in.idx)];
  var L = s.a + u.params.x;
  // 边框略亮,示意标志轮廓
  let b = min(min(in.uv.x, 1.0 - in.uv.x), min(in.uv.y, 1.0 - in.uv.y));
  var hue = s.rgb;
  if (b < 0.04) { L *= 1.6; hue = vec3f(1.0); }
  let t = toneMap(L, u.params.y);
  return vec4f(hue * t, 1.0);
}
`;
