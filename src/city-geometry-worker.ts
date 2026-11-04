import { geoNaturalEarth1 } from "d3-geo";
import type { Feature, Geometry, Position } from "geojson";
import { buildCityGeometry } from "./webgl-renderer";

type Request = {
  areas: Feature<Geometry>[];
  scale: number;
  translate: [number, number];
};
type Result =
  | { type: "success"; fill: Float32Array; borders: Float32Array }
  | { type: "error"; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: Result, transfer?: Transferable[]) => void;
};

scope.onmessage = (event: MessageEvent<Request>) => {
  try {
    const projection = geoNaturalEarth1()
      .scale(event.data.scale)
      .translate(event.data.translate);
    const geometry = buildCityGeometry(event.data.areas, (coordinate: Position) => {
      const point = projection(coordinate as [number, number]);
      return point && Number.isFinite(point[0]) && Number.isFinite(point[1])
        ? [point[0], point[1]]
        : null;
    });
    scope.postMessage(
      { type: "success", ...geometry },
      [geometry.fill.buffer, geometry.borders.buffer],
    );
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
