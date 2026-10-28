import earcut from "earcut";
import type { Feature, Geometry, Position } from "geojson";

export type ProjectedPoint = [number, number];
export type Projection = (coordinate: Position) => ProjectedPoint | null | undefined;
export type Rgba = [number, number, number, number];

type GeometryArrays = { fill: number[]; borders: number[] };
type BoundaryArrays = { borders: number[] };
type BiomeBatch = { buffer: WebGLBuffer; count: number; color: Rgba };

function simplifyRing(points: ProjectedPoint[], tolerance: number): ProjectedPoint[] {
  if (tolerance <= 0 || points.length < 5) return points;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  // Preserve tiny islands and small polygon features even when they are sub-pixel.
  if (Math.abs(twiceArea) / 2 < 1.25) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.001;
  const source = closed ? points.slice(0, -1) : points;
  if (source.length < 4) return points;
  const simplified: ProjectedPoint[] = [source[0]!];
  let previous = source[0]!;
  const thresholdSquared = tolerance * tolerance;
  for (let i = 1; i < source.length - 1; i++) {
    const point = source[i]!;
    const dx = point[0] - previous[0], dy = point[1] - previous[1];
    if (dx * dx + dy * dy >= thresholdSquared) {
      simplified.push(point);
      previous = point;
    }
  }
  simplified.push(source[source.length - 1]!);
  return simplified.length >= 3 ? simplified : points;
}

function appendRingSegments(points: ProjectedPoint[], output: number[], thickness = 1): void {
  if (points.length < 2 || thickness <= 0) return;
  const half = thickness / 2;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 0.001) continue;
    const nx = (-dy / length) * half, ny = (dx / length) * half;
    // Six vertices per segment; offset remains in screen pixels as zoom changes.
    output.push(
      a[0], a[1], nx, ny,
      a[0], a[1], -nx, -ny,
      b[0], b[1], nx, ny,
      b[0], b[1], nx, ny,
      a[0], a[1], -nx, -ny,
      b[0], b[1], -nx, -ny,
    );
  }
}

function uploadBorderBuffer(gl: WebGLRenderingContext, buffer: WebGLBuffer, values: number[]): number {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
  return values.length / 4;
}

function collectPolygon(rings: Position[][], project: Projection, output: GeometryArrays, tolerance = 0, borderThickness = 1): void {
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
    const simplifiedRing = simplifyRing(points, tolerance);
    if (projectedRings.length) holes.push(flat.length / 2);
    projectedRings.push(simplifiedRing);
    for (const [x, y] of simplifiedRing) flat.push(x, y);
  }
  if (!projectedRings.length) return;
  for (const index of earcut(flat, holes, 2)) output.fill.push(flat[index * 2]!, flat[index * 2 + 1]!);
  for (const ring of projectedRings) appendRingSegments(ring, output.borders, borderThickness);
}

function collectBoundaryPolygon(rings: Position[][], project: Projection, output: BoundaryArrays, tolerance = 0, borderThickness = 1): void {
  for (const ring of rings) {
    const points: ProjectedPoint[] = [];
    for (const coordinate of ring) {
      const point = project(coordinate);
      if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) points.push(point);
    }
    appendRingSegments(simplifyRing(points, tolerance), output.borders, borderThickness);
  }
}

function collectBoundaryGeometry(geometry: Geometry | null, project: Projection, output: BoundaryArrays, tolerance = 0, borderThickness = 1): void {
  if (!geometry) return;
  switch (geometry.type) {
    case "Polygon": collectBoundaryPolygon(geometry.coordinates, project, output, tolerance, borderThickness); break;
    case "MultiPolygon": for (const polygon of geometry.coordinates) collectBoundaryPolygon(polygon, project, output, tolerance, borderThickness); break;
    case "GeometryCollection": for (const child of geometry.geometries) collectBoundaryGeometry(child, project, output, tolerance, borderThickness); break;
  }
}

function collectGeometry(geometry: Geometry | null, project: Projection, output: GeometryArrays, tolerance = 0, borderThickness = 1): void {
  if (!geometry) return;
  switch (geometry.type) {
    case "Polygon": collectPolygon(geometry.coordinates, project, output, tolerance, borderThickness); break;
    case "MultiPolygon": for (const polygon of geometry.coordinates) collectPolygon(polygon, project, output, tolerance, borderThickness); break;
    case "GeometryCollection": for (const child of geometry.geometries) collectGeometry(child, project, output, tolerance, borderThickness); break;
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
const borderVertexShader = `
attribute vec2 a_position;
attribute vec2 a_offset;
uniform vec2 u_resolution;
uniform vec2 u_translation;
uniform float u_scale;
void main() {
  vec2 p = a_position * u_scale + u_translation;
  vec2 clip = (p / u_resolution) * 2.0 - 1.0;
  clip += (a_offset / u_resolution) * 2.0;
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
  private readonly borderProgram: WebGLProgram;
  private readonly borderPosition: number;
  private readonly borderOffset: number;
  private readonly borderResolution: WebGLUniformLocation;
  private readonly borderTranslation: WebGLUniformLocation;
  private readonly borderScale: WebGLUniformLocation;
  private readonly borderColor: WebGLUniformLocation;
  private readonly position: number;
  private readonly resolution: WebGLUniformLocation;
  private readonly translation: WebGLUniformLocation;
  private readonly scale: WebGLUniformLocation;
  private readonly color: WebGLUniformLocation;
  private readonly fillBuffer: WebGLBuffer;
  private readonly lowFillBuffer: WebGLBuffer;
  private readonly borderBuffer: WebGLBuffer;
  private readonly lowBorderBuffer: WebGLBuffer;
  private readonly administrativeBuffer: WebGLBuffer;
  private readonly lowAdministrativeBuffer: WebGLBuffer;
  private readonly lakeBuffer: WebGLBuffer;
  private readonly lowLakeBuffer: WebGLBuffer;
  private readonly cityBuffer: WebGLBuffer;
  private readonly cityBorderBuffer: WebGLBuffer;
  private readonly selectionFillBuffer: WebGLBuffer;
  private readonly selectionBorderBuffer: WebGLBuffer;
  private readonly biomeBatches = new Map<string, BiomeBatch>();
  private fillCount = 0;
  private lowFillCount = 0;
  private borderCount = 0;
  private lowBorderCount = 0;
  private administrativeCount = 0;
  private lowAdministrativeCount = 0;
  private lakeVertexCount = 0;
  private lowLakeVertexCount = 0;
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

    const borderProgram = gl.createProgram();
    if (!borderProgram) throw new Error("Unable to allocate WebGL border program.");
    const borderVertex = compileShader(gl, gl.VERTEX_SHADER, borderVertexShader);
    const borderFragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
    gl.attachShader(borderProgram, borderVertex);
    gl.attachShader(borderProgram, borderFragment);
    gl.linkProgram(borderProgram);
    gl.deleteShader(borderVertex);
    gl.deleteShader(borderFragment);
    if (!gl.getProgramParameter(borderProgram, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(borderProgram) ?? "WebGL border program link failed.";
      gl.deleteProgram(borderProgram);
      throw new Error(message);
    }
    this.borderProgram = borderProgram;
    this.borderPosition = gl.getAttribLocation(borderProgram, "a_position");
    this.borderOffset = gl.getAttribLocation(borderProgram, "a_offset");
    this.borderResolution = gl.getUniformLocation(borderProgram, "u_resolution")!;
    this.borderTranslation = gl.getUniformLocation(borderProgram, "u_translation")!;
    this.borderScale = gl.getUniformLocation(borderProgram, "u_scale")!;
    this.borderColor = gl.getUniformLocation(borderProgram, "u_color")!;

    this.position = gl.getAttribLocation(program, "a_position");
    this.resolution = gl.getUniformLocation(program, "u_resolution")!;
    this.translation = gl.getUniformLocation(program, "u_translation")!;
    this.scale = gl.getUniformLocation(program, "u_scale")!;
    this.color = gl.getUniformLocation(program, "u_color")!;
    this.fillBuffer = gl.createBuffer()!;
    this.lowFillBuffer = gl.createBuffer()!;
    this.borderBuffer = gl.createBuffer()!;
    this.lowBorderBuffer = gl.createBuffer()!;
    this.administrativeBuffer = gl.createBuffer()!;
    this.lowAdministrativeBuffer = gl.createBuffer()!;
    this.lakeBuffer = gl.createBuffer()!;
    this.lowLakeBuffer = gl.createBuffer()!;
    this.cityBuffer = gl.createBuffer()!;
    this.cityBorderBuffer = gl.createBuffer()!;
    this.selectionFillBuffer = gl.createBuffer()!;
    this.selectionBorderBuffer = gl.createBuffer()!;
    if (![this.fillBuffer, this.lowFillBuffer, this.borderBuffer, this.lowBorderBuffer, this.administrativeBuffer, this.lowAdministrativeBuffer, this.lakeBuffer, this.lowLakeBuffer, this.cityBuffer, this.cityBorderBuffer, this.selectionFillBuffer, this.selectionBorderBuffer].every(Boolean)) {
      throw new Error("Unable to allocate WebGL geometry buffers.");
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  setGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: GeometryArrays = { fill: [], borders: [] };
    const low: GeometryArrays = { fill: [], borders: [] };
    for (const feature of features) {
      collectGeometry(feature.geometry, project, arrays, 0, 2.6);
      collectGeometry(feature.geometry, project, low, 0.65, 2.6);
    }
    this.fillCount = uploadBuffer(this.gl, this.fillBuffer, arrays.fill);
    this.borderCount = uploadBorderBuffer(this.gl, this.borderBuffer, arrays.borders);
    this.lowFillCount = uploadBuffer(this.gl, this.lowFillBuffer, low.fill);
    this.lowBorderCount = uploadBorderBuffer(this.gl, this.lowBorderBuffer, low.borders);
  }

  setAdministrativeGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: BoundaryArrays = { borders: [] };
    const low: BoundaryArrays = { borders: [] };
    for (const feature of features) {
      collectBoundaryGeometry(feature.geometry, project, arrays, 0, 0.8);
      collectBoundaryGeometry(feature.geometry, project, low, 0.65, 0.8);
    }
    this.administrativeCount = uploadBorderBuffer(this.gl, this.administrativeBuffer, arrays.borders);
    this.lowAdministrativeCount = uploadBorderBuffer(this.gl, this.lowAdministrativeBuffer, low.borders);
  }

  setLakeGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: GeometryArrays = { fill: [], borders: [] };
    const low: GeometryArrays = { fill: [], borders: [] };
    for (const feature of features) {
      collectGeometry(feature.geometry, project, arrays, 0, 0);
      collectGeometry(feature.geometry, project, low, 0.65, 0);
    }
    this.lakeVertexCount = uploadBuffer(this.gl, this.lakeBuffer, arrays.fill);
    this.lowLakeVertexCount = uploadBuffer(this.gl, this.lowLakeBuffer, low.fill);
  }

  setCityGeometry(features: Feature<Geometry>[], project: Projection): void {
    const arrays: GeometryArrays = { fill: [], borders: [] };
    for (const feature of features) collectGeometry(feature.geometry, project, arrays, 0, 0.8);
    this.cityVertexCount = uploadBuffer(this.gl, this.cityBuffer, arrays.fill);
    this.cityBorderCount = uploadBorderBuffer(this.gl, this.cityBorderBuffer, arrays.borders);
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
      collectGeometry(feature.geometry, project, { fill: batch.values, borders: [] }, 0.65, 0);
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
    if (feature) collectGeometry(feature.geometry, project, arrays, 0, 2.2);
    this.selectionFillCount = uploadBuffer(this.gl, this.selectionFillBuffer, arrays.fill);
    this.selectionBorderCount = uploadBorderBuffer(this.gl, this.selectionBorderBuffer, arrays.borders);
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

    const drawFill = (buffer: WebGLBuffer, count: number, color: Rgba): void => {
      if (count <= 0) return;
      gl.useProgram(this.program);
      gl.uniform2f(this.resolution, Math.max(1, width), Math.max(1, height));
      gl.uniform2f(this.translation, panX, panY);
      gl.uniform1f(this.scale, zoom);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(this.position);
      gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform4f(this.color, color[0], color[1], color[2], color[3]);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    };
    const drawBorder = (buffer: WebGLBuffer, count: number, color: Rgba): void => {
      if (count <= 0) return;
      gl.useProgram(this.borderProgram);
      gl.uniform2f(this.borderResolution, Math.max(1, width), Math.max(1, height));
      gl.uniform2f(this.borderTranslation, panX, panY);
      gl.uniform1f(this.borderScale, zoom);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(this.borderPosition);
      gl.enableVertexAttribArray(this.borderOffset);
      gl.vertexAttribPointer(this.borderPosition, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(this.borderOffset, 2, gl.FLOAT, false, 16, 8);
      gl.uniform4f(this.borderColor, color[0], color[1], color[2], color[3]);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    };

    const detailed = zoom >= 2;
    drawFill(detailed ? this.fillBuffer : this.lowFillBuffer, detailed ? this.fillCount : this.lowFillCount, [0.91, 0.86, 0.73, 1]);
    for (const batch of this.biomeBatches.values()) drawFill(batch.buffer, batch.count, batch.color);
    drawFill(detailed ? this.lakeBuffer : this.lowLakeBuffer, detailed ? this.lakeVertexCount : this.lowLakeVertexCount, [0.14, 0.35, 0.44, 1]);
    drawBorder(detailed ? this.borderBuffer : this.lowBorderBuffer, detailed ? this.borderCount : this.lowBorderCount, [0.09, 0.09, 0.07, 1]);
    drawBorder(detailed ? this.administrativeBuffer : this.lowAdministrativeBuffer, detailed ? this.administrativeCount : this.lowAdministrativeCount, [0.52, 0.51, 0.47, 0.96]);
    if (zoom >= 2) {
      drawFill(this.cityBuffer, this.cityVertexCount, [0.65, 0.48, 0.31, 0.72]);
      drawBorder(this.cityBorderBuffer, this.cityBorderCount, [0.96, 0.90, 0.73, 0.95]);
    }
    drawFill(this.selectionFillBuffer, this.selectionFillCount, [0.87, 0.62, 0.18, 0.45]);
    drawBorder(this.selectionBorderBuffer, this.selectionBorderCount, [1, 0.94, 0.72, 1]);
  }

  destroy(): void {
    for (const buffer of [this.fillBuffer, this.lowFillBuffer, this.borderBuffer, this.lowBorderBuffer, this.administrativeBuffer, this.lowAdministrativeBuffer, this.lakeBuffer, this.lowLakeBuffer, this.cityBuffer, this.cityBorderBuffer, this.selectionFillBuffer, this.selectionBorderBuffer]) this.gl.deleteBuffer(buffer);
    for (const batch of this.biomeBatches.values()) this.gl.deleteBuffer(batch.buffer);
    this.biomeBatches.clear();
    this.gl.deleteProgram(this.program);
    this.gl.deleteProgram(this.borderProgram);
  }
}
