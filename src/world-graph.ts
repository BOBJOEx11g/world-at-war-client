import { geoBounds, geoCentroid, geoContains } from "d3-geo";
import type { Position } from "geojson";
import type { AdministrativeFeature } from "./admin-boundaries";

export type GraphCity = {
  id: string;
  name: string;
  country: string;
  longitude: number;
  latitude: number;
  isCapital?: boolean;
};

export type StrategicNode = {
  id: string;
  kind: "province" | "city";
  name: string;
  country: string;
  longitude: number;
  latitude: number;
  provinceId: string | null;
  isCapital: boolean;
};

export type StrategicPath = {
  id: string;
  from: string;
  to: string;
  kind: "province-border" | "city-link";
  via: null;
};

export type StrategicGraph = {
  nodes: StrategicNode[];
  paths: StrategicPath[];
  nodeById: Map<string, StrategicNode>;
  territoryNodeByProvinceId: Map<string, string>;
  replacedProvinceByCityId: Map<string, string>;
  cityIdByReplacedProvinceId: Map<string, string>;
};

function provinceId(feature: AdministrativeFeature): string {
  return String(feature.id ?? feature.properties.shapeID ?? feature.properties.shapeName ?? "unknown");
}

function geometryRings(geometry: GeoJSON.Geometry | null): Position[][] {
  if (!geometry) return [];
  switch (geometry.type) {
    case "Polygon": return geometry.coordinates;
    case "MultiPolygon": return geometry.coordinates.flat();
    case "GeometryCollection": return geometry.geometries.flatMap(geometryRings);
    default: return [];
  }
}

/** Finds a point inside the largest land component, including island provinces. */
function interiorCoordinate(feature: AdministrativeFeature): [number, number] {
  const centroid = geoCentroid(feature) as [number, number];
  if (centroid.every(Number.isFinite) && geoContains(feature, centroid)) return centroid;

  const components: GeoJSON.Geometry[] = [];
  const collect = (geometry: GeoJSON.Geometry | null): void => {
    if (!geometry) return;
    if (geometry.type === "Polygon") components.push(geometry);
    else if (geometry.type === "MultiPolygon") {
      for (const coordinates of geometry.coordinates) components.push({ type: "Polygon", coordinates });
    } else if (geometry.type === "GeometryCollection") {
      for (const child of geometry.geometries) collect(child);
    }
  };
  collect(feature.geometry);

  // Check each island separately; a province-wide centroid can land in the sea.
  const candidates = components.map((geometry) => {
    const component: GeoJSON.Feature<GeoJSON.Geometry> = { type: "Feature", properties: {}, geometry };
    const bounds = geoBounds(component) as [[number, number], [number, number]];
    return { component, bounds, area: Math.abs((bounds[1][0] - bounds[0][0]) * (bounds[1][1] - bounds[0][1])) };
  }).sort((a, b) => b.area - a.area);

  for (const { component, bounds } of candidates) {
    const center = geoCentroid(component) as [number, number];
    if (center.every(Number.isFinite) && geoContains(component, center)) return center;
    const [[west, south], [east, north]] = bounds;
    for (let divisions = 4; divisions <= 20; divisions += 4) {
      for (let y = 1; y < divisions; y++) for (let x = 1; x < divisions; x++) {
        const point: [number, number] = [west + (east - west) * x / divisions, south + (north - south) * y / divisions];
        if (geoContains(component, point)) return point;
      }
    }
    for (const ring of geometryRings(component.geometry)) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i]!, b = ring[i + 1]!;
        if (typeof a[0] !== "number" || typeof a[1] !== "number" || typeof b[0] !== "number" || typeof b[1] !== "number") continue;
        const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        for (const fraction of [0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9]) {
          const point: [number, number] = [midpoint[0] + (center[0] - midpoint[0]) * fraction, midpoint[1] + (center[1] - midpoint[1]) * fraction];
          if (geoContains(component, point)) return point;
        }
      }
    }
  }
  for (const ring of geometryRings(feature.geometry)) {
    const first = ring.find((point) => typeof point[0] === "number" && typeof point[1] === "number" && Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (first && typeof first[0] === "number" && typeof first[1] === "number") return [first[0], first[1]];
  }
  return centroid;
}

function pointKey(point: Position): string {
  return `${Number(point[0]).toFixed(5)},${Number(point[1]).toFixed(5)}`;
}
function edgeKey(a: Position, b: Position): string {
  const left = pointKey(a), right = pointKey(b);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

/**
 * One permanent province node per Admin-1 territory, plus a separate node for
 * every major city. Adjacent provinces share one direct node-to-node route.
 */
export function buildStrategicGraph(provinces: AdministrativeFeature[], cities: GraphCity[]): StrategicGraph {
  const nodes: StrategicNode[] = [];
  const paths: StrategicPath[] = [];
  const nodeById = new Map<string, StrategicNode>();
  const territoryNodeByProvinceId = new Map<string, string>();
  const replacedProvinceByCityId = new Map<string, string>();
  const cityIdByReplacedProvinceId = new Map<string, string>();
  const provinceById = new Map<string, AdministrativeFeature>();

  for (const province of provinces) {
    const id = provinceId(province);
    provinceById.set(id, province);
    const [longitude, latitude] = interiorCoordinate(province);
    const node: StrategicNode = {
      id: `province:${id}`, kind: "province",
      name: String(province.properties.shapeName ?? province.properties.name ?? "Unnamed province"),
      country: String(province.properties.admin ?? province.properties.parentCountryId ?? "Unknown country"),
      longitude, latitude, provinceId: id, isCapital: false,
    };
    nodes.push(node); nodeById.set(node.id, node);
    territoryNodeByProvinceId.set(id, node.id);
  }

  // City points are separate crossroads; they never replace their province node.
  for (const city of cities) {
    if (!Number.isFinite(city.longitude) || !Number.isFinite(city.latitude)) continue;
    const parent = provinces.find((province) => {
      try { return geoContains(province, [city.longitude, city.latitude]); } catch { return false; }
    });
    const parentId = parent ? provinceId(parent) : null;
    const node: StrategicNode = {
      id: `city:${city.id}`, kind: "city", name: city.name, country: city.country,
      longitude: city.longitude, latitude: city.latitude, provinceId: parentId,
      isCapital: city.isCapital ?? false,
    };
    nodes.push(node); nodeById.set(node.id, node);
    const provinceNodeId = parentId ? territoryNodeByProvinceId.get(parentId) : undefined;
    if (provinceNodeId) paths.push({
      id: `city-link:${node.id}:${provinceNodeId}`,
      from: node.id, to: provinceNodeId, kind: "city-link", via: null,
    });
  }

  // Match shared boundary segments, but deduplicate to exactly one route per pair.
  const edgeOwners = new Map<string, Set<string>>();
  for (const province of provinces) {
    const id = provinceId(province);
    const nodeId = territoryNodeByProvinceId.get(id);
    if (!nodeId) continue;
    for (const ring of geometryRings(province.geometry)) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i]!, b = ring[i + 1]!;
        if (typeof a[0] !== "number" || typeof a[1] !== "number" ||
            typeof b[0] !== "number" || typeof b[1] !== "number") continue;
        const key = edgeKey(a, b);
        const owners = edgeOwners.get(key) ?? new Set<string>();
        owners.add(nodeId); edgeOwners.set(key, owners);
      }
    }
  }
  const connectedPairs = new Set<string>();
  for (const owners of edgeOwners.values()) {
    const ids = [...owners];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const left = ids[i]!;
      const right = ids[j]!;
      const from = left < right ? left : right;
      const to = left < right ? right : left;
      const key = `${from}|${to}`;
      if (connectedPairs.has(key)) continue;
      connectedPairs.add(key);
      paths.push({ id: `route:${key}`, from, to, kind: "province-border", via: null });
    }
  }
  return { nodes, paths, nodeById, territoryNodeByProvinceId, replacedProvinceByCityId, cityIdByReplacedProvinceId };
}
