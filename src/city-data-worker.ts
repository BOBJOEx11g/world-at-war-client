import { geoBounds, geoCentroid, geoDistance } from "d3-geo";
import type { Feature, Geometry } from "geojson";

type AreaProperties = { name?: string; NAME?: string; [key: string]: unknown };
type PlaceProperties = { name?: string; NAME?: string; nameascii?: string; adm0name?: string; ADM0NAME?: string; admin?: string; ADMIN?: string; ADM0CAP?: number | string; [key: string]: unknown };
type AreaFeature = Feature<Geometry, AreaProperties>;
type PlaceFeature = Feature<Geometry, PlaceProperties>;
type Request = { areasUrl: string; placesUrl: string };
type RecordData = { index: number; id: string; name: string; country: string; isCapital: boolean };
type Result = {
  type: "success";
  areas: AreaFeature[];
  records: RecordData[];
  indexCells: Array<[string, number[]]>;
  globalIndices: number[];
};

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown) => void;
};

function placeGridKey(longitude: number, latitude: number): string {
  return `${Math.floor((longitude + 180) / 5)}:${Math.floor((latitude + 90) / 5)}`;
}

function spatialCellKey(longitude: number, latitude: number): string {
  const x = Math.max(0, Math.min(35, Math.floor((longitude + 180) / 10)));
  const y = Math.max(0, Math.min(17, Math.floor((latitude + 90) / 10)));
  return `${x}:${y}`;
}

function buildSpatialIndex(areas: AreaFeature[]): { cells: Map<string, number[]>; global: number[] } {
  const cells = new Map<string, number[]>();
  const global: number[] = [];
  for (let index = 0; index < areas.length; index++) {
    const feature = areas[index]!;
    try {
      const bounds = geoBounds(feature);
      const west = bounds[0][0], south = bounds[0][1], east = bounds[1][0], north = bounds[1][1];
      const longitudeRanges: Array<[number, number]> = east < west ? [[west, 180], [-180, east]] : [[west, east]];
      const keys: string[] = [];
      for (const [rangeWest, rangeEast] of longitudeRanges) {
        const minX = Math.max(0, Math.min(35, Math.floor((rangeWest + 180) / 10)));
        const maxX = Math.max(0, Math.min(35, Math.floor((rangeEast + 180) / 10)));
        const minY = Math.max(0, Math.min(17, Math.floor((south + 90) / 10)));
        const maxY = Math.max(0, Math.min(17, Math.floor((north + 90) / 10)));
        for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) keys.push(`${x}:${y}`);
      }
      const uniqueKeys = [...new Set(keys)];
      if (uniqueKeys.length > 180) { global.push(index); continue; }
      for (const key of uniqueKeys) {
        const bucket = cells.get(key) ?? [];
        bucket.push(index);
        cells.set(key, bucket);
      }
    } catch {
      global.push(index);
    }
  }
  return { cells, global };
}

scope.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const [areasResponse, placesResponse] = await Promise.all([
      fetch(event.data.areasUrl, { headers: { accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(30000) }),
      fetch(event.data.placesUrl, { headers: { accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(30000) }),
    ]);
    if (!areasResponse.ok) throw new Error(`Urban-area request failed: HTTP ${areasResponse.status}`);
    if (!placesResponse.ok) throw new Error(`Populated-place request failed: HTTP ${placesResponse.status}`);
    const [areasDataset, placesDataset] = await Promise.all([areasResponse.json(), placesResponse.json()]) as [
      { type?: string; features?: AreaFeature[] },
      { type?: string; features?: PlaceFeature[] }
    ];
    if (areasDataset.type !== "FeatureCollection" || !Array.isArray(areasDataset.features) ||
        placesDataset.type !== "FeatureCollection" || !Array.isArray(placesDataset.features)) {
      throw new Error("City sources did not return valid GeoJSON FeatureCollections.");
    }
    const areas = areasDataset.features;
    const places = placesDataset.features;
    if (!areas.length || !places.length) throw new Error("City sources returned no features.");

    const placeGrid = new Map<string, PlaceFeature[]>();
    for (const place of places) {
      if (place.geometry?.type !== "Point") continue;
      const [longitude, latitude] = place.geometry.coordinates;
      if (typeof longitude !== "number" || typeof latitude !== "number") continue;
      const key = placeGridKey(longitude, latitude);
      const bucket = placeGrid.get(key) ?? [];
      bucket.push(place);
      placeGrid.set(key, bucket);
    }

    const records: RecordData[] = areas.map((feature, index) => {
      const center = geoCentroid(feature);
      let nearest: PlaceFeature | null = null;
      let nearestDistance = Infinity;
      if (Number.isFinite(center[0]) && Number.isFinite(center[1])) {
        const lonCell = Math.floor((center[0] + 180) / 5);
        const latCell = Math.floor((center[1] + 90) / 5);
        const lonRadius = Math.abs(center[1]) > 65 ? 6 : 3;
        for (let dx = -lonRadius; dx <= lonRadius; dx++) {
          for (let dy = -3; dy <= 3; dy++) {
            const bucket = placeGrid.get(`${lonCell + dx}:${latCell + dy}`);
            if (!bucket) continue;
            for (const place of bucket) {
              if (place.geometry?.type !== "Point") continue;
              const distance = geoDistance(center, place.geometry.coordinates as [number, number]);
              if (distance < nearestDistance) { nearestDistance = distance; nearest = place; }
            }
          }
        }
      }
      const areaProps = feature.properties ?? {};
      const placeProps = nearest?.properties ?? {};
      const areaName = String(areaProps.name ?? areaProps.NAME ?? "").trim();
      const placeName = String(placeProps.name ?? placeProps.NAME ?? placeProps.nameascii ?? "").trim();
      const name = placeName && nearestDistance <= 0.08 ? placeName : areaName || placeName || `Urban area ${index + 1}`;
      const country = String(placeProps.adm0name ?? placeProps.ADM0NAME ?? placeProps.admin ?? placeProps.ADMIN ?? "Country unavailable");
      const id = `city-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      return { index, id, name, country, isCapital: nearestDistance <= 0.02 && Number(placeProps.ADM0CAP) === 1 };
    });

    const spatialIndex = buildSpatialIndex(areas);
    const result: Result = {
      type: "success",
      areas,
      records,
      indexCells: [...spatialIndex.cells.entries()],
      globalIndices: spatialIndex.global,
    };
    scope.postMessage(result);
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
