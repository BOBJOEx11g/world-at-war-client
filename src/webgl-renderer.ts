import earcut from "earcut";
import type { Feature, Geometry, Position } from "geojson";

export type ProjectedPoint = [number, number];
export type Projection = (coordinate: Position) => ProjectedPoint | null | undefined;

type GeometryArrays = { fill: number[]; borders: number[]; borderRanges: Array<[number, number]> };
type BoundaryArrays = { borders: number[]; borderRanges: Array<[number, number]> };

function collectPolygon(rings: Position[][], project: Projection, output: GeometryArrays): void {
  const flat: number[] = [];
  const holes: number[] = [];
  const projectedRings: ProjectedPoint[][] = [];
  for (const ring of rings) {
    const points: ProjectedPoint[] = [];
    for (const coordinate of ring) {
      const point = project(coordinate);
      if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) points.push(point);
    }
    if (points.length < 3) continue;
    if (projectedRings.length) holes.push(flat.length / 2);
    projectedRings.push(points);
    for (const [x, y] of points) flat.push(x, y);
  }
  if (!projectedRings.length) return;
  for (const index of earcut(flat, holes, 2)) output.fill.push(flat[index * 2]!, flat[index * 2 + 1]!);
  for (const ring of projectedRings) {
    const start = output.borders.length / 2;
    for (const [x, y] of ring) output.borders.push(x, y);
    output.borderRanges.push([start, ring.length]);
  }
}

function collectBoundaryPolygon(rings: Position[][], project: Projection, output: BoundaryArrays): void {
  for (const ring of rings) {
    const points: ProjectedPoint[] = [];
    for (const coordinate of ring) {
      const point = project(coordinate);
      if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) points.push(point);
    }
    if (points.length < 3) continue;
    const start = output.borders.length / 2;
    for (const [x, y] of points) output.borders.push(x, y);
    output.borderRanges.push([start, points.length]);
  }
}

function collectBoundaryGeometry(geometry: Geometry | null, project: Projection, output: BoundaryArrays): void {
  if (!geometry) return;
  switch (geometry.type) {
    case "Polygon": collectBoundaryPolygon(geometry.coordinates, project, output); break;
    case "MultiPolygon": for (const polygon of geometry.coordinates) collectBoundaryPolygon(polygon, project, output); break;
    case "GeometryCollection": for (const child of geometry.geometries) collectBoundaryGeometry(child, project, output); break;
  }
}

function collectGeometry(geometry: Geometry | null, project: Projection, output: GeometryArrays): void {
  if (!geometry) return;
  switch (geometry.type) {
    case "Polygon": collectPolygon(geometry.coordinates, project, output); break;
    case "MultiPolygon": for (const polygon of geometry.coordinates) collectPolygon(polygon, project, output); break;
    case "GeometryCollection": for (const child of geometry.geometries) collectGeometry(child, project, output); break;
  }
}

const vertexShader = `
attribute vec2 a_position;
uniform vec2 u_resolution;
uniform vec2 u_translation;
uniform float u_scale;
void main() {
  vec2 p = a_position * u_scale + u_translation;
  vec2 clip = (p / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;
const fragmentShader = `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader compilation error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

/** GPU-backed polygon batches. Geographic geometry is projected once; pan and zoom are uniforms. */
export class WebGLMapRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly position: number;
  private readonly resolution: WebGLUniformLocation;
  private readonly translation: WebGLUniformLocation;
  private readonly scale: WebGLUniformLocation;
  private readonly color: WebGLUniformLocation;
  private readonly fillBuffer: WebGLBuffer;
  private readonly borderBuffer: WebGLBuffer;
  private fillCount = 0;
  private borderRanges: Array<[number, number]> = [];
  private readonly administrativeBuffer: WebGLBuffer;
  private administrativeRanges: Array<[number, number]> = [];

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, powerPreference: "low-power" });
    if (!gl) throw new Error("WebGL is unavailable on this device or browser.");
    this.canvas = canvas;
    this.gl = gl;
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate WebGL program.");
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "WebGL program link failed.");
    this.program = program;
    this.position = gl.getAttribLocation(program, "a_position");
    this.resolution = gl.getUniformLocation(program, "u_resolution")!;
    this.translation = gl.getUniformLocation(program, "u_translation")!;
    this.scale = gl.getUniformLocation(program, "u_scale")!;
    this.color = gl.getUniformLocation(program, "u_color")!;
    this.fillBuffer = gl.createBuffer()!;
    this.borderBuffer = gl.createBuffer()!;
    this.administrativeBuffer = gl.createBuffer()!;
    this.lakeBuffer = gl.createBuffer()!;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  setGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: GeometryArrays = { fill: [], borders: [], borderRanges: [] };
    for (const feature of features) collectGeometry(feature.geometry, project, arrays);
    this.fillCount = arrays.fill.length / 2;
    this.borderRanges = arrays.borderRanges;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.fillBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(arrays.fill), this.gl.STATIC_DRAW);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.borderBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(arrays.borders), this.gl.STATIC_DRAW);
  }

  setAdministrativeGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: GeometryArrays = { fill: [], borders: [], borderRanges: [] };
    for (const feature of features) collectGeometry(feature.geometry, project, arrays);
    this.administrativeRanges = arrays.borderRanges;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.administrativeBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(arrays.borders), this.gl.STATIC_DRAW);
  }

  resize(width: number, height: number): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(width: number, height: number, panX: number, panY: number, zoom: number): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.resolution, this.canvas.width, this.canvas.height);
    const ratio = this.canvas.width / Math.max(1, width);
    gl.uniform2f(this.translation, panX * ratio, panY * ratio);
    gl.uniform1f(this.scale, zoom);
    gl.enableVertexAttribArray(this.position);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fillBuffer);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(this.color, 0.91, 0.86, 0.73, 1);
    gl.drawArrays(gl.TRIANGLES, 0, this.fillCount);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.borderBuffer);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(this.color, 0.09, 0.09, 0.07, 1);
    for (const [start, count] of this.borderRanges) gl.drawArrays(gl.LINE_LOOP, start, count);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.administrativeBuffer);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(this.color, 0.52, 0.51, 0.47, 0.96);
    for (const [start, count] of this.administrativeRanges) gl.drawArrays(gl.LINE_LOOP, start, count);
  }

  destroy(): void {
    this.gl.deleteBuffer(this.fillBuffer);
    this.gl.deleteBuffer(this.borderBuffer);
    this.gl.deleteBuffer(this.administrativeBuffer);
    this.gl.deleteBuffer(this.lakeBuffer);
    this.gl.deleteProgram(this.program);
  }
}
