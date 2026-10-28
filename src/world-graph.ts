import { geoBounds, geoCentroid, geoContains } from "d3-geo";
import type { Feature, Geometry, Position } from "geojson";
import type { AdministrativeFeature } from "./admin-boundaries";

export type GraphCity = {
  id: string;
  name: string;
  country: string;
  feature: Feature<Geometry, { [key: string]: unknown }>;
};

export type StrategicNode = {
  id: string;
  kind: "province" | "city";
  name: string;
  country: string;
  longitude: number;
  latitude: number;
  provinceId: string | null;
  /** Capital status is independent of node/territory type. */
  isCapital: boolean;
};

export type StrategicPath = {
  id: string;
  from: string;
  to: string;
  kind: "province-border" | "city-link";
  /** Shared border midpoint for province connections; null for city links. */
  via: [number, number] | null;
};

export type StrategicGraph = {
  nodes: StrategicNode[];
  paths: StrategicPath[];
  nodeById: Map<string, StrategicNode>;
  territoryNodeByProvinceId: Map<string, string>;
  replacedProvinceByCityId: Map<string, string>;
};

function provinceId(feature: AdministrativeFeature): string {
  return String(feature.id ?? feature.properties.shapeID ?? feature.properties.shapeName ?? "unknown");
}

function geometryRings(geometry: Geometry | null): Position[][] {
  if (!geometry) return [];
  switch (geometry.type) {
    case "Polygon": return geometry.coordinates;
    case "MultiPolygon": return geometry.coordinates.flat();
    case "GeometryCollection": return geometry.geometries.flatMap(geometryRings);
    default: return [];
  }
}

function outerRingPositions(geometry: Geometry | null): Position[] {
  if (!geometry) return [];
  switch (geometry.type) {
    case "Polygon": return geometry.coordinates[0] ?? [];
    case "MultiPolygon": return geometry.coordinates.flatMap((polygon) => polygon[0] ?? []);
    case "GeometryCollection": return geometry.geometries.flatMap(outerRingPositions);
    default: return [];
  }
}

function boundsContain(outer: [[number, number], [number, number]], inner: [[number, number], [number, number]]): boolean {
  const [[west, south], [east, north]] = outer;
  const [[innerWest, innerSouth], [innerEast, innerNorth]] = inner;
  // Antimeridian-spanning shapes are excluded from this fast containment check.
  if (east < west || innerEast < innerWest) return false;
  return west <= innerWest + 1e-5 && east >= innerEast - 1e-5 &&
    south <= innerSouth + 1e-5 && north >= innerNorth - 1e-5;
}

function cityFullyCoversProvince(city: GraphCity, province: AdministrativeFeature): boolean {
  if (!city.feature.geometry || !province.geometry) return false;
  try {
    const positions = outerRingPositions(province.geometry);
    if (positions.length < 4) return false;
    // Every outer-ring vertex must be inside the urban polygon. This is a conservative
    // coverage test: ambiguous/partial overlaps do not merge separate territories.
    return positions.every((position) => typeof position[0] === "number" &&
      typeof position[1] === "number" && geoContains(city.feature, [position[0], position[1]]));
  } catch {
    return false;
  }
}

function edgeKey(a: Position, b: Position): string {
  const pointKey = (p: Position) => `${Number(p[0]).toFixed(5)},${Number(p[1]).toFixed(5)}`;
  const left = pointKey(a), right = pointKey(b);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function sharedEdges(feature: AdministrativeFeature): Array<{ key: string; midpoint: [number, number] }> {
  const edges: Array<{ key: string; midpoint: [number, number] }> = [];
  for (const ring of geometryRings(feature.geometry)) {
    for (let index = 0; index < ring.length - 1; index++) {
      const a = ring[index]!, b = ring[index + 1]!;
      if (typeof a[0] !== "number" || typeof a[1] !== "number" ||
          typeof b[0] !== "number" || typeof b[1] !== "number") continue;
      edges.push({ key: edgeKey(a, b), midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
    }
  }
  return edges;
}

/**
 * Builds a provisional strategic graph from the map's existing geometry.
 * Paths are graph links, not real roads/railways; transport networks and costs are later data.
 */
export function buildStrategicGraph(
  provinces: AdministrativeFeature[],
  cities: GraphCity[],
): StrategicGraph {
  const nodes: StrategicNode[] = [];
  const paths: StrategicPath[] = [];
  const nodeById = new Map<string, StrategicNode>();
  const territoryNodeByProvinceId = new Map<string, string>();
  const replacedProvinceByCityId = new Map<string, string>();
  const provinceNodeIds = new Map<string, string>();
  const provinceById = new Map(provinces.map((feature) => [provinceId(feature), feature] as const));

  const coveringCityByProvince = new Map<string, GraphCity>();
  const cityBounds = cities.map((city) => {
    try { return { city, bounds: geoBounds(city.feature) as [[number, number], [number, number]] }; }
    catch { return null; }
  }).filter((entry): entry is { city: GraphCity; bounds: [[number, number], [number, number]] } => entry !== null)
    .sort((a, b) => {
      const areaA = Math.abs((a.bounds[1][0] - a.bounds[0][0]) * (a.bounds[1][1] - a.bounds[0][1]));
      const areaB = Math.abs((b.bounds[1][0] - b.bounds[0][0]) * (b.bounds[1][1] - b.bounds[0][1]));
      return areaB - areaA;
    });
  for (const province of provinces) {
    const id = provinceId(province);
    let provinceBounds: [[number, number], [number, number]];
    try { provinceBounds = geoBounds(province) as [[number, number], [number, number]]; } catch { continue; }
    const provinceArea = Math.abs((provinceBounds[1][0] - provinceBounds[0][0]) * (provinceBounds[1][1] - provinceBounds[0][1]));
    for (const candidate of cityBounds) {
      const cityArea = Math.abs((candidate.bounds[1][0] - candidate.bounds[0][0]) * (candidate.bounds[1][1] - candidate.bounds[0][1]));
      if (cityArea + 1e-6 < provinceArea) break;
      if (!boundsContain(candidate.bounds, provinceBounds)) continue;
      if (cityFullyCoversProvince(candidate.city, province)) {
        coveringCityByProvince.set(id, candidate.city);
        replacedProvinceByCityId.set(candidate.city.id, id);
        break;
      }
    }
  }

  for (const province of provinces) {
    const id = provinceId(province);
    const coveringCity = coveringCityByProvince.get(id);
    if (coveringCity) {
      const center = geoCentroid(coveringCity.feature);
      const node: StrategicNode = {
        id: `city:${coveringCity.id}`,
        kind: "city",
        name: coveringCity.name,
        country: coveringCity.country,
        longitude: center[0],
        latitude: center[1],
        provinceId: id,
        isCapital: false,
      };
      nodes.push(node);
      nodeById.set(node.id, node);
      territoryNodeByProvinceId.set(id, node.id);
      provinceNodeIds.set(id, node.id);
      continue;
    }
    const center = geoCentroid(province);
    const node: StrategicNode = {
      id: `province:${id}`,
      kind: "province",
      name: String(province.properties.shapeName ?? province.properties.name ?? "Unnamed province"),
      country: String(province.properties.admin ?? province.properties.parentCountryId ?? "Unknown country"),
      longitude: center[0],
      latitude: center[1],
      provinceId: id,
      isCapital: false,
    };
    nodes.push(node);
    nodeById.set(node.id, node);
    territoryNodeByProvinceId.set(id, node.id);
    provinceNodeIds.set(id, node.id);
  }

  // Build a coarse spatial grid so city-to-province lookup doesn't scan every province.
  const provinceGrid = new Map<string, AdministrativeFeature[]>();
  const globalProvinces: AdministrativeFeature[] = [];
  const cellKey = (longitude: number, latitude: number) => `${Math.floor((longitude + 180) / 5)}:${Math.floor((latitude + 90) / 5)}`;
  for (const province of provinces) {
    try {
      const [[west, south], [east, north]] = geoBounds(province);
      const minX = Math.max(0, Math.min(71, Math.floor((west + 180) / 5)));
      const maxX = Math.max(0, Math.min(71, Math.floor((east + 180) / 5)));
      const minY = Math.max(0, Math.min(35, Math.floor((south + 90) / 5)));
      const maxY = Math.max(0, Math.min(35, Math.floor((north + 90) / 5)));
      if ((maxX - minX + 1) * (maxY - minY + 1) > 250) { globalProvinces.push(province); continue; }
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
        const key = `${x}:${y}`;
        const bucket = provinceGrid.get(key) ?? [];
        bucket.push(province);
        provinceGrid.set(key, bucket);
      }
    } catch { globalProvinces.push(province); }
  }

  // Urban nodes remain separate only when they do not replace an entire province.
  for (const city of cities) {
    if (replacedProvinceByCityId.has(city.id)) continue;
    const center = geoCentroid(city.feature);
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) continue;
    const candidates = [...(provinceGrid.get(cellKey(center[0], center[1])) ?? []), ...globalProvinces];
    const parent = candidates.find((province) => {
      try { return geoContains(province, center); } catch { return false; }
    });
    const parentId = parent ? provinceId(parent) : null;
    const node: StrategicNode = {
      id: `city:${city.id}`,
      kind: "city",
      name: city.name,
      country: city.country,
      longitude: center[0],
      latitude: center[1],
      provinceId: parentId,
      isCapital: false,
    };
    nodes.push(node);
    nodeById.set(node.id, node);
    const territoryNode = parentId ? territoryNodeByProvinceId.get(parentId) : undefined;
    if (territoryNode && territoryNode !== node.id) {
      paths.push({ id: `city-link:${node.id}:${territoryNode}`, from: node.id, to: territoryNode, kind: "city-link", via: null });
    }
  }

  // Shared source-border segments create the initial province-to-province graph.
  // A province replaced by a city uses that city's node for all of its connections.
  const edges = new Map<string, Array<{ territoryId: string; midpoint: [number, number] }>>();
  for (const province of provinces) {
    const id = provinceId(province);
    const territoryId = provinceNodeIds.get(id);
    if (!territoryId) continue;
    for (const edge of sharedEdges(province)) {
      const bucket = edges.get(edge.key) ?? [];
      bucket.push({ territoryId, midpoint: edge.midpoint });
      edges.set(edge.key, bucket);
    }
  }
  const pathKeys = new Set<string>();
  for (const bucket of edges.values()) {
    const unique = [...new Map(bucket.map((entry) => [entry.territoryId, entry] as const)).values()];
    if (unique.length < 2) continue;
    for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i]!, b = unique[j]!;
      if (a.territoryId === b.territoryId) continue;
      const key = [a.territoryId, b.territoryId].sort().join("|");
      if (pathKeys.has(key)) continue;
      pathKeys.add(key);
      paths.push({
        id: `border:${key}`,
        from: a.territoryId,
        to: b.territoryId,
        kind: "province-border",
        via: a.midpoint,
      });
    }
  }

  // Keep the lookup map explicit: callers can resolve a province to its actual territory node.
  for (const [id, feature] of provinceById) {
    if (!territoryNodeByProvinceId.has(id) && feature) territoryNodeByProvinceId.set(id, `province:${id}`);
  }
  return { nodes, paths, nodeById, territoryNodeByProvinceId, replacedProvinceByCityId };
}
