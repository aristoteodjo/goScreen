import type { Quad } from "@goscreen/render-engine";

// Draws a bitmap onto a perspective quad, with depth of field: Canvas 2D has
// no projective transform, so a small WebGL program does the warp and blurs
// each pixel by its depth (the far edge of a leaning screen goes soft, like
// the course's camera with a wide aperture). One shared context, reused for
// every layer of every frame; the result is drawn back into the 2D context.

const VERT = `
attribute vec2 a_ndc;
attribute float a_w;
attribute vec2 a_uv;
attribute float a_z;
varying vec2 v_uv;
varying float v_z;
void main() {
  // w carries the perspective: varyings interpolate perspective-correctly.
  gl_Position = vec4(a_ndc * a_w, 0.0, a_w);
  v_uv = a_uv;
  v_z = a_z;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_radius;
uniform float u_zref;
uniform float u_alpha;
varying vec2 v_uv;
varying float v_z;
void main() {
  float r = u_radius * clamp(abs(v_z) / u_zref, 0.0, 1.0);
  vec4 c;
  if (r < 0.5) {
    c = texture2D(u_tex, v_uv);
  } else {
    // Two rings of taps, rotated per pixel by a hash: ghost copies turn
    // into fine grain instead of showing as doubled text.
    float h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float a0 = h * 6.2831853;
    vec2 k = u_texel * r;
    c = texture2D(u_tex, v_uv) * 2.0;
    for (int i = 0; i < 8; i++) {
      float a = a0 + float(i) * 0.7853982;
      vec2 d = vec2(cos(a), sin(a));
      c += texture2D(u_tex, v_uv + k * d * 0.5);
      c += texture2D(u_tex, v_uv + k * d * (1.0 + 0.3 * h));
    }
    c /= 18.0;
  }
  gl_FragColor = c * u_alpha;
}`;

type Warper = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  texture: WebGLTexture;
  loc: {
    ndc: number;
    w: number;
    uv: number;
    z: number;
    texel: WebGLUniformLocation | null;
    radius: WebGLUniformLocation | null;
    zref: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
  };
};

let warper: Warper | null | undefined;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function setup(): Warper | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    antialias: true,
  });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!vs || !fs || !program || !buffer || !texture) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  // biome-ignore lint/correctness/useHookAtTopLevel: a WebGL call, not a React hook
  gl.useProgram(program);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return {
    canvas,
    gl,
    program,
    buffer,
    texture,
    loc: {
      ndc: gl.getAttribLocation(program, "a_ndc"),
      w: gl.getAttribLocation(program, "a_w"),
      uv: gl.getAttribLocation(program, "a_uv"),
      z: gl.getAttribLocation(program, "a_z"),
      texel: gl.getUniformLocation(program, "u_texel"),
      radius: gl.getUniformLocation(program, "u_radius"),
      zref: gl.getUniformLocation(program, "u_zref"),
      alpha: gl.getUniformLocation(program, "u_alpha"),
    },
  };
}

export type WarpOptions = {
  // The bitmap's corners on the destination, in destination units (the
  // 2D context's current user space), top-left first, clockwise.
  quad: Quad;
  // Depth of each corner (destination units, positive = far) and the depth
  // at which the blur reaches `blur`.
  depth: [number, number, number, number];
  zref: number;
  // Max blur radius in bitmap pixels (0 = sharp everywhere).
  blur: number;
  alpha: number;
  // Destination units -> device pixels of the 2D canvas.
  pixelScale: number;
};

/** Whether the GPU warp is available (a 2D fallback is used otherwise). */
export function canWarp(): boolean {
  if (warper === undefined) warper = setup();
  return warper !== null;
}

/**
 * Warps `image` onto `quad` and draws it into `ctx` (whose transform is
 * applied to the quad's bounding box). Falls back to a plain drawImage into
 * the quad's bounds when WebGL is unavailable.
 */
export function drawWarped(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  o: WarpOptions,
) {
  const xs = o.quad.map((p) => p.x);
  const ys = o.quad.map((p) => p.y);
  const box = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  if (box.width < 1 || box.height < 1) return;
  if (warper === undefined) warper = setup();
  if (!warper) {
    ctx.save();
    ctx.globalAlpha *= o.alpha;
    ctx.drawImage(image, box.x, box.y, box.width, box.height);
    ctx.restore();
    return;
  }
  const { gl, canvas, loc, buffer, texture } = warper;
  const w = Math.min(4096, Math.ceil(box.width * o.pixelScale));
  const h = Math.min(4096, Math.ceil(box.height * o.pixelScale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

  // Corner order for a triangle strip: TL, TR, BL, BR.
  const order = [0, 1, 3, 2];
  const uvs = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const far = Math.max(1e-3, ...o.depth.map((z) => Math.abs(z)));
  // The homogeneous weight grows with depth; any positive scale works, the
  // ratio between corners is what makes the interpolation perspective-correct.
  const data: number[] = [];
  order.forEach((i, k) => {
    const p = o.quad[i];
    const ndcX = ((p.x - box.x) / box.width) * 2 - 1;
    const ndcY = 1 - ((p.y - box.y) / box.height) * 2;
    const wgt = 1 + o.depth[i] / (far * 4);
    data.push(ndcX, ndcY, wgt, uvs[k][0], uvs[k][1], o.depth[i]);
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
  const stride = 6 * 4;
  gl.enableVertexAttribArray(loc.ndc);
  gl.vertexAttribPointer(loc.ndc, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(loc.w);
  gl.vertexAttribPointer(loc.w, 1, gl.FLOAT, false, stride, 8);
  gl.enableVertexAttribArray(loc.uv);
  gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(loc.z);
  gl.vertexAttribPointer(loc.z, 1, gl.FLOAT, false, stride, 20);

  gl.uniform2f(loc.texel, 1 / image.width, 1 / image.height);
  gl.uniform1f(loc.radius, o.blur);
  gl.uniform1f(loc.zref, Math.max(1e-3, o.zref));
  gl.uniform1f(loc.alpha, Math.max(0, Math.min(1, o.alpha)));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  ctx.drawImage(canvas, box.x, box.y, box.width, box.height);
}
