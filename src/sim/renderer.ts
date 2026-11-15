import type { Film, Scheme, Vec3 } from '../types';
import { mat4LookAt, mat4Mul, mat4Perspective, rad } from '../math3';
import { buildAlignment, type Alignment } from '../road/alignment';
import { buildRoadMesh, buildSigns, type RoadMesh, type SignMesh } from './scene';
import { ROAD_WGSL, SIGN_WGSL } from './shaders';
import { buildHighBeam, buildLowBeam, type CandelaTable } from '../optics/headlamp';
import type { LampGeom } from '../optics/luminance';

export interface FrameInput {
  eye: Vec3;
  target: Vec3;
  lamps: LampGeom[];           // 两个前灯
  beam: 'low' | 'high';
  wetness: number;
  exposure: number;
  veiling: number;             // 对向眩光光幕亮度 cd/m²
  station: number;             // 当前里程(用于窗口化绘制)
  markingRL: [number, number]; // 干燥/潮湿 RL (cd/m²/lx)
  laneWidth: number;
  lanesPerDir: number;
  signLums: Float32Array;      // 每个标志的亮度(CPU 光度计算结果)
  oncoming: { quad: Float32Array<ArrayBuffer> } | null; // 对向车灯两个四边形顶点(12×6 floats)
}

const MAX_SIGNS = 64;

export class Renderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private depthTex: GPUTexture | null = null;
  private roadPipeline!: GPURenderPipeline;
  private signPipeline!: GPURenderPipeline;
  private roadUB!: GPUBuffer;
  private signUB!: GPUBuffer;
  private roadBind!: GPUBindGroup;
  private signBind!: GPUBindGroup;
  private roadVB: GPUBuffer | null = null;
  private roadIB: GPUBuffer | null = null;
  private signVB: GPUBuffer | null = null;
  private signIB: GPUBuffer | null = null;
  private oncomingVB!: GPUBuffer;
  private roadMesh: RoadMesh | null = null;
  private signMesh: SignMesh | null = null;
  private lowBeam: CandelaTable = buildLowBeam();
  private highBeam: CandelaTable = buildHighBeam();
  private signCount = 0;
  private canvas: HTMLCanvasElement;
  alignment: Alignment | null = null;
  signInstances: SignMesh['instances'] = [];

  private constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    const r = new Renderer(canvas);
    if (!navigator.gpu) throw new Error('NO_WEBGPU');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('NO_ADAPTER');
    r.device = await adapter.requestDevice();
    r.context = canvas.getContext('webgpu') as GPUCanvasContext;
    r.format = navigator.gpu.getPreferredCanvasFormat();
    r.context.configure({ device: r.device, format: r.format, alphaMode: 'opaque' });
    r.buildPipelines();
    return r;
  }

  private buildPipelines(): void {
    const d = this.device;
    this.roadUB = d.createBuffer({ size: 288, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.signUB = d.createBuffer({ size: 64 + MAX_SIGNS * 16 + 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.oncomingVB = d.createBuffer({ size: 12 * 6 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

    const mkTex = (t: CandelaTable): GPUTexture => {
      const tex = d.createTexture({
        size: [t.hCount, t.vCount],
        format: 'r32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      d.queue.writeTexture({ texture: tex }, t.data, { bytesPerRow: t.hCount * 4, rowsPerImage: t.vCount }, [t.hCount, t.vCount]);
      return tex;
    };
    const lowTex = mkTex(this.lowBeam);
    const highTex = mkTex(this.highBeam);

    const roadMod = d.createShaderModule({ code: ROAD_WGSL });
    const signMod = d.createShaderModule({ code: SIGN_WGSL });

    this.roadPipeline = d.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: roadMod, entryPoint: 'vs',
        buffers: [{
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32' },
            { shaderLocation: 3, offset: 28, format: 'float32' },
          ],
        }],
      },
      fragment: { module: roadMod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.signPipeline = d.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: signMod, entryPoint: 'vs',
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' },
            { shaderLocation: 2, offset: 20, format: 'float32' },
          ],
        }],
      },
      fragment: { module: signMod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.roadBind = d.createBindGroup({
      layout: this.roadPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.roadUB } },
        { binding: 1, resource: lowTex.createView() },
        { binding: 2, resource: highTex.createView() },
      ],
    });
    this.signBind = d.createBindGroup({
      layout: this.signPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.signUB } }],
    });
  }

  setScene(scheme: Scheme, _films: Film[]): void {
    const d = this.device;
    this.alignment = buildAlignment(scheme.horiz, scheme.vpis);
    this.roadMesh = buildRoadMesh(this.alignment, scheme.cross, scheme.designKmh);
    this.signMesh = buildSigns(scheme, this.alignment);
    this.signInstances = this.signMesh.instances;
    this.signCount = Math.min(this.signMesh.instances.length, MAX_SIGNS - 2);
    this.roadVB?.destroy(); this.roadIB?.destroy(); this.signVB?.destroy(); this.signIB?.destroy();
    this.roadVB = d.createBuffer({ size: this.roadMesh.vertexData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.roadVB, 0, this.roadMesh.vertexData);
    this.roadIB = d.createBuffer({ size: this.roadMesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(this.roadIB, 0, this.roadMesh.indices);
    if (this.signMesh.vertexData.byteLength > 0) {
      this.signVB = d.createBuffer({ size: this.signMesh.vertexData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(this.signVB, 0, this.signMesh.vertexData);
      this.signIB = d.createBuffer({ size: this.signMesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(this.signIB, 0, this.signMesh.indices);
    } else {
      this.signVB = null; this.signIB = null;
    }
  }

  private ensureDepth(w: number, h: number): void {
    if (this.depthTex && this.depthTex.width === w && this.depthTex.height === h) return;
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({
      size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  renderFrame(inp: FrameInput): void {
    if (!this.roadMesh || !this.roadVB || !this.roadIB) return;
    const d = this.device;
    const w = this.canvas.width, h = this.canvas.height;
    if (w === 0 || h === 0) return;
    this.ensureDepth(w, h);

    const aspect = w / h;
    const proj = mat4Perspective(rad(55), aspect, 0.3, 2000);
    const view = mat4LookAt(inp.eye, inp.target, { x: 0, y: 1, z: 0 });
    const vp = mat4Mul(proj, view);

    // ---- 路面 uniform(共 68 floats = 272 字节) ----
    const u = new Float32Array(68);
    u.set(vp, 0);
    u.set([inp.eye.x, inp.eye.y, inp.eye.z, inp.wetness], 16);
    for (let i = 0; i < 2; i++) {
      const L = inp.lamps[i];
      u.set([L.pos.x, L.pos.y, L.pos.z, 0], 20 + i * 4);
      u.set([L.dir.x, L.dir.y, L.dir.z, 0], 28 + i * 4);
      u.set([L.right.x, L.right.y, L.right.z, 0], 36 + i * 4);
      u.set([L.up.x, L.up.y, L.up.z, 0], 44 + i * 4);
    }
    u.set([inp.laneWidth, inp.lanesPerDir, inp.markingRL[0], inp.markingRL[1]], 52);
    u.set([inp.veiling, inp.exposure, 0.12, 0.07], 56);
    const t = this.lowBeam;
    u.set([t.hMin, t.hStep, t.vMin, t.vStep], 60);
    u.set([t.hCount, t.vCount, inp.beam === 'high' ? 1 : 0, 0], 64);
    d.queue.writeBuffer(this.roadUB, 0, u);

    // ---- 标志 uniform ----
    const su = new Float32Array(16 + MAX_SIGNS * 4 + 4);
    su.set(vp, 0);
    for (let i = 0; i < MAX_SIGNS; i++) {
      const inst = this.signInstances[i];
      const base = 16 + i * 4;
      if (inst && i < this.signCount) {
        su[base] = inst.color[0]; su[base + 1] = inst.color[1]; su[base + 2] = inst.color[2];
        su[base + 3] = inp.signLums[i] ?? 0;
      } else if (i >= MAX_SIGNS - 2) {
        su[base] = 1; su[base + 1] = 1; su[base + 2] = 0.95;
        su[base + 3] = inp.oncoming ? 3e6 : 0; // 对向车灯:极高亮度
      } else {
        su[base + 3] = 0;
      }
    }
    su.set([inp.veiling, inp.exposure, 0, 0], 16 + MAX_SIGNS * 4);
    d.queue.writeBuffer(this.signUB, 0, su);

    if (inp.oncoming) {
      d.queue.writeBuffer(this.oncomingVB, 0, inp.oncoming.quad);
    }

    const encoder = d.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.004, g: 0.005, b: 0.01, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTex!.createView(),
        depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });

    // 路面:按里程窗口绘制(前方 500m,后方 30m)
    pass.setPipeline(this.roadPipeline);
    pass.setBindGroup(0, this.roadBind);
    pass.setVertexBuffer(0, this.roadVB);
    pass.setIndexBuffer(this.roadIB, 'uint32');
    const step = this.roadMesh.step;
    const firstRow = Math.max(0, Math.floor((inp.station - 30) / step));
    const lastRow = Math.min(this.roadMesh.rows - 1, Math.ceil((inp.station + 500) / step));
    const indexCount = (lastRow - firstRow) * 6;
    if (indexCount > 0) pass.drawIndexed(indexCount, 1, firstRow * 6);

    // 标志
    if (this.signVB && this.signIB && this.signMesh) {
      pass.setPipeline(this.signPipeline);
      pass.setBindGroup(0, this.signBind);
      pass.setVertexBuffer(0, this.signVB);
      pass.setIndexBuffer(this.signIB, 'uint32');
      pass.drawIndexed(this.signMesh.indices.length);
      // 对向车灯
      if (inp.oncoming) {
        pass.setVertexBuffer(0, this.oncomingVB);
        pass.draw(12);
      }
    } else if (inp.oncoming) {
      pass.setPipeline(this.signPipeline);
      pass.setBindGroup(0, this.signBind);
      pass.setVertexBuffer(0, this.oncomingVB);
      pass.draw(12);
    }

    pass.end();
    d.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.roadVB?.destroy(); this.roadIB?.destroy();
    this.signVB?.destroy(); this.signIB?.destroy();
    this.depthTex?.destroy();
    this.roadUB?.destroy(); this.signUB?.destroy();
    this.device?.destroy();
  }
}
