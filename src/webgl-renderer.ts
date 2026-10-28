import earcut from "earcut";
import type { Feature, Geometry, Position } from "geojson";

export type ProjectedPoint = [number, number];
export type Projection = (coordinate: Position) => ProjectedPoint | null | undefined;
export type Rgba = [number, number, number, number];

type GeometryArrays = { fill: number[]; borders: number[] };
type BoundaryArrays = { borders: number[] };
type BiomeBatch = { buffer: WebGLBuffer; count: number; color: Rgba };

function appendRingSegments(points: ProjectedPoint[], output: number[]): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    output.push(a[0], a[1], b[0], b[1]);
  }
}

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
  for (const ring of projectedRings) appendRingSegments(ring, output.borders);
}

function collectBoundaryPolygon(rings: Position[][], project: Projection, output: BoundaryArrays): void {
  for (const ring of rings) {
    const points: ProjectedPoint[] = [];
    for (const coordinate of ring) {
      const point = project(coordinate);
      if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) points.push(point);
    }
    appendRingSegments(points, output.borders);
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

function uploadBuffer(gl: WebGLRenderingContext, buffer: WebGLBuffer, values: number[]): number {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
  return values.length / 2;
}

/** GPU-backed map layers. Static geometry is triangulated once per projection; view changes use uniforms only. */
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
  private readonly administrativeBuffer: WebGLBuffer;
  private readonly lakeBuffer: WebGLBuffer;
  private readonly cityBuffer: WebGLBuffer;
  private readonly cityBorderBuffer: WebGLBuffer;
  private readonly selectionFillBuffer: WebGLBuffer;
  private readonly selectionBorderBuffer: WebGLBuffer;
  private readonly biomeBatches = new Map<string, BiomeBatch>();
  private fillCount = 0;
  private borderCount = 0;
  private administrativeCount = 0;
  private lakeVertexCount = 0;
  private cityVertexCount = 0;
  private cityBorderCount = 0;
  private selectionFillCount = 0;
  private selectionBorderCount = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL is unavailable on this device or browser.");
    this.canvas = canvas;
    this.gl = gl;
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate WebGL program.");
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShader);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) ?? "WebGL program link failed.";
      gl.deleteProgram(program);
      throw new Error(message);
    }
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
    this.cityBuffer = gl.createBuffer()!;
    this.cityBorderBuffer = gl.createBuffer()!;
    this.selectionFillBuffer = gl.createBuffer()!;
    this.selectionBorderBuffer = gl.createBuffer()!;
    if (![this.fillBuffer, this.borderBuffer, this.administrativeBuffer, this.lakeBuffer, this.cityBuffer, this.cityBorderBuffer, this.selectionFillBuffer, this.selectionBorderBuffer].every(Boolean)) {
      throw new Error("Unable to allocate WebGL geometry buffers.");
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  setGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: GeometryArrays = { fill: [], borders: [] };
    for (const feature of features) collectGeometry(feature.geometry, project, arrays);
    this.fillCount = uploadBuffer(this.gl, this.fillBuffer, arrays.fill);
    this.borderCount = uploadBuffer(this.gl, this.borderBuffer, arrays.borders);
  }

  setAdministrativeGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: BoundaryArrays = { borders: [] };
    for (const feature of features) collectBoundaryGeometry(feature.geometry, project, arrays);
    this.administrativeCount = uploadBuffer(this.gl, this.administrativeBuffer, arrays.borders);
  }

  setLakeGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: GeometryArrays = { fill: [], borders: [] };
    for (const feature of features) collectGeometry(feature.geometry, project, arrays);
    this.lakeVertexCount = uploadBuffer(this.gl, this.lakeBuffer, arrays.fill);
  }

  setCityGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: GeometryArrays = { fill: [], borders: [] };
    for (const feature of features) collectGeometry(feature.geometry, project, arrays);
    this.cityVertexCount = uploadBuffer(this.gl, this.cityBuffer, arrays.fill);
    this.cityBorderCount = uploadBuffer(this.gl, this.cityBorderBuffer, arrays.borders);
  }

  setBiomeGeometry(
    features: Feature<Geometry>[],
    project: Projection,
    getStyle: (feature: Feature<Geometry>) => { key: string; color: Rgba },
  ): void {
    for (const batch of this.biomeBatches.values()) this.gl.deleteBuffer(batch.buffer);
    this.biomeBatches.clear();
    const grouped = new Map<string, { color: Rgba; values: number[] }>();
    for (const feature of features) {
      const style = getStyle(feature);
      const batch = grouped.get(style.key) ?? { color: style.color, values: [] };
      collectGeometry(feature.geometry, project, { fill: batch.values, borders: [] });
      grouped.set(style.key, batch);
    }
    for (const [key, group] of grouped) {
      const buffer = this.gl.createBuffer();
      if (!buffer) continue;
      const count = uploadBuffer(this.gl, buffer, group.values);
      this.biomeBatches.set(key, { buffer, count, color: group.color });
    }
  }

  setSelection(feature: Feature<Geometry> | null, project: Projection): void {
    const arrays: GeometryArrays = { fill: [], borders: [] };
    if (feature) collectGeometry(feature.geometry, project, arrays);
    this.selectionFillCount = uploadBuffer(this.gl, this.selectionFillBuffer, arrays.fill);
    this.selectionBorderCount = uploadBuffer(this.gl, this.selectionBorderBuffer, arrays.borders);
  }

  resize(width: number, height: number): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.gl.viewport(0, 0, pixelWidth, pixelHeight);
  }

  render(width: number, height: number, panX: number, panY: number, zoom: number): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    // Projection coordinates and pan are in CSS pixels; the viewport alone uses device pixels.
    gl.uniform2f(this.resolution, Math.max(1, width), Math.max(1, height));
    gl.uniform2f(this.translation, panX, panY);
    gl.uniform1f(this.scale, zoom);
    gl.enableVertexAttribArray(this.position);

    const draw = (buffer: WebGLBuffer, count: number, mode: number, color: Rgba): void => {
      if (count <= 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform4f(this.color, color[0], color[1], color[2], color[3]);
      gl.drawArrays(mode, 0, count);
    };

    draw(this.fillBuffer, this.fillCount, gl.TRIANGLES, [0.91, 0.86, 0.73, 1]);
    for (const batch of this.biomeBatches.values()) draw(batch.buffer, batch.count, gl.TRIANGLES, batch.color);
    draw(this.lakeBuffer, this.lakeVertexCount, gl.TRIANGLES, [0.14, 0.35, 0.44, 1]);
    draw(this.borderBuffer, this.borderCount, gl.LINES, [0.09, 0.09, 0.07, 1]);
    draw(this.administrativeBuffer, this.administrativeCount, gl.LINES, [0.52, 0.51, 0.47, 0.96]);
    if (zoom >= 2) {
      draw(this.cityBuffer, this.cityVertexCount, gl.TRIANGLES, [0.65, 0.48, 0.31, 0.72]);
      draw(this.cityBorderBuffer, this.cityBorderCount, gl.LINES, [0.96, 0.90, 0.73, 0.95]);
    }
    draw(this.selectionFillBuffer, this.selectionFillCount, gl.TRIANGLES, [0.87, 0.62, 0.18, 0.45]);
    draw(this.selectionBorderBuffer, this.selectionBorderCount, gl.LINES, [1, 0.94, 0.72, 1]);
  }

  destroy(): void {
    for (const buffer of [this.fillBuffer, this.borderBuffer, this.administrativeBuffer, this.lakeBuffer, this.cityBuffer, this.cityBorderBuffer, this.selectionFillBuffer, this.selectionBorderBuffer]) this.gl.deleteBuffer(buffer);
    for (const batch of this.biomeBatches.values()) this.gl.deleteBuffer(batch.buffer);
    this.biomeBatches.clear();
    this.gl.deleteProgram(this.program);
  }
}
