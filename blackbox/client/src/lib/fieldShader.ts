// Decorative WebGL field behind the incident picture (ported from the approved reference). Optional:
// without WebGL it reports available=false and the SVG/text picture is complete on its own.
// It is a summary illustration only; it never represents telemetry or network discovery.
export type Field = { available: boolean; draw(state?: FieldState): void; dispose(): void };
export type FieldState = { phase?: number; progress?: number; time?: number; pointer?: [number, number]; contained?: boolean; conflict?: boolean };

const VERTEX = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
const FRAGMENT = `precision mediump float;
uniform vec2 resolution;uniform vec2 pointer;uniform float time;uniform float phase;uniform float progress;uniform float contained;uniform float conflict;
float line(float x,float width){return 1.-smoothstep(0.,width,abs(x));}
void main(){vec2 uv=gl_FragCoord.xy/resolution;float aspect=resolution.x/resolution.y;
vec3 base=vec3(.025,.043,.067);vec2 grid=abs(fract(uv*vec2(45.,18.))-.5);float fine=(1.-smoothstep(.001,.016,min(grid.x,grid.y)))*.025;
vec3 col=base+vec3(.2,.35,.55)*fine;float scan=exp(-pow((uv.x-progress)*48.,2.));col+=vec3(.055,.12,.22)*scan;
vec2 source=vec2(.17,.53);vec2 d=(uv-source)*vec2(aspect,1.);float r=length(d);float detect=exp(-r*r*14.);float ring=line(r-(.11+.08*progress),.009);
float redPhase=1.-smoothstep(.2,.8,abs(phase-1.));float isolate=step(1.5,phase)*contained;float warning=step(2.5,phase)*conflict;
col+=vec3(.22,.028,.042)*detect*redPhase;col+=vec3(.035,.11,.08)*detect*isolate;
col+=vec3(.08,.22,.16)*ring*isolate*.5;float boundary=line(max(abs(d.x)/1.9,abs(d.y))-.16,.0025);col+=vec3(.025,.09,.06)*boundary*isolate;
vec2 far=(uv-vec2(.88,.52))*vec2(aspect,1.);float glow=exp(-dot(far,far)*28.);col+=vec3(.12,.08,.025)*glow*warning;
vec2 md=(uv-pointer)*vec2(aspect,1.);float hover=exp(-dot(md,md)*24.);col+=vec3(.035,.055,.08)*hover;
float border=pow(max(abs(uv.x-.5)*2.,abs(uv.y-.5)*2.),4.);col*=1.-border*.3;gl_FragColor=vec4(col,.95);}`;

const none: Field = { available: false, draw() {}, dispose() {} };

export function createField(canvas: HTMLCanvasElement): Field {
  let gl: WebGLRenderingContext | null = null;
  try { gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: false }); } catch { /* no WebGL */ }
  if (!gl) return none;
  const g = gl;
  const shader = (type: number, source: string) => {
    const sh = g.createShader(type)!;
    g.shaderSource(sh, source); g.compileShader(sh);
    if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) { g.deleteShader(sh); throw Error('shader unavailable'); }
    return sh;
  };
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null;
  try {
    const v = shader(g.VERTEX_SHADER, VERTEX), f = shader(g.FRAGMENT_SHADER, FRAGMENT);
    program = g.createProgram()!;
    g.attachShader(program, v); g.attachShader(program, f); g.linkProgram(program);
    g.deleteShader(v); g.deleteShader(f);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) throw Error('program unavailable');
    g.useProgram(program);
    buffer = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(program, 'position');
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  } catch {
    if (program) g.deleteProgram(program);
    if (buffer) g.deleteBuffer(buffer);
    return none;
  }
  const p = program;
  const u = Object.fromEntries(['resolution', 'pointer', 'time', 'phase', 'progress', 'contained', 'conflict'].map(k => [k, g.getUniformLocation(p, k)]));
  let disposed = false;
  return {
    available: true,
    draw({ phase = 0, progress = 0.1, time = 0, pointer = [0.5, 0.5], contained = false, conflict = false } = {}) {
      if (disposed || g.isContextLost()) return;
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; g.viewport(0, 0, w, h); }
      g.useProgram(p);
      g.uniform2f(u.resolution, w, h); g.uniform2f(u.pointer, pointer[0], pointer[1]);
      g.uniform1f(u.phase, phase); g.uniform1f(u.progress, progress); g.uniform1f(u.time, time);
      g.uniform1f(u.contained, contained ? 1 : 0); g.uniform1f(u.conflict, conflict ? 1 : 0);
      g.drawArrays(g.TRIANGLES, 0, 6);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      g.deleteBuffer(buffer); g.deleteProgram(p);
      g.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
