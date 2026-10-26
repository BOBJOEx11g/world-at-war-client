/**
 * Loads the global first-level administrative geography from geoBoundaries gbOpen.
 * All available ADM1 geometries are fetched and cached in memory so movement
 * planning can use a world-wide region index rather than click-triggered data.
 * Source: https://www.geoboundaries.org/ — CC BY 4.0, attribution required.
 */

export type AdministrativeProperties = {
  shapeName?: string;
  shapeID?: string | number;
  shapeGroup?: string;
  shapeType?: string;
  parentCountryId?: string;
  administrativeLevel?: "state-province" | "county-district";
  sourceBoundaryId?: string;
  [key: string]: unknown;
};

export type AdministrativeFeature = GeoJSON.Feature<
  GeoJSON.Geometry,
  AdministrativeProperties
>;

export type AdministrativeFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  AdministrativeProperties
>;

type GeoBoundariesMetadata = {
  boundaryID?: string;
  boundaryISO?: string;
  boundaryType?: string;
  boundaryYearRepresented?: string;
  boundaryLicense?: string;
  boundaryName?: string;
  simplifiedGeometryGeoJSON?: string;
  gjDownloadURL?: string;
};

const API_ROOT = "https://www.geoboundaries.org/api/current/gbOpen";
let globalAdm1Promise: Promise<AdministrativeFeature[]> | null = null;

function stableRegionId(countryCode: string, feature: AdministrativeFeature, index: number): string {
  const sourceId = feature.properties?.shapeID ?? feature.id;
  if (sourceId !== undefined && sourceId !== null && String(sourceId).trim()) {
    return `${countryCode}-ADM1-${String(sourceId).trim()}`;
  }
  const name = String(feature.properties?.shapeName ?? "unnamed")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${countryCode}-ADM1-${name || index}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/geo+json, application/json" },
  });
  if (!response.ok) throw new Error(`Request failed: HTTP ${response.status} (${url})`);
  return response.json() as Promise<unknown>;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await task(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadGlobalAdm1(): Promise<AdministrativeFeature[]> {
  const metadataPayload = await fetchJson(`${API_ROOT}/ALL/ADM1/`);
  const metadata = (Array.isArray(metadataPayload) ? metadataPayload : [metadataPayload])
    .filter((item): item is GeoBoundariesMetadata => Boolean(item && typeof item === "object"))
    .filter((item) => typeof item.boundaryISO === "string" && /^[A-Z]{3}$/.test(item.boundaryISO))
    .filter((item) => item.boundaryType === "ADM1");

  const countryFeatures = await mapWithConcurrency(metadata, 8, async (entry) => {
    const countryCode = entry.boundaryISO!;
    const dataUrl = entry.simplifiedGeometryGeoJSON || entry.gjDownloadURL;
    if (!dataUrl) return [] as AdministrativeFeature[];
    try {
      const payload = await fetchJson(dataUrl);
      const collection = payload as AdministrativeFeatureCollection;
      if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) return [];
      return collection.features.map((feature, index) => ({
        ...feature,
        id: stableRegionId(countryCode, feature, index),
        properties: {
          ...(feature.properties ?? {}),
          parentCountryId: countryCode,
          administrativeLevel: "state-province" as const,
          sourceBoundaryId: entry.boundaryID ?? `${countryCode}-ADM1`,
        },
      }));
    } catch (error) {
      // One country's missing/temporarily unavailable data must not block the world map.
      console.warn(`Unable to load ADM1 boundaries for ${countryCode}`, error);
      return [] as AdministrativeFeature[];
    }
  });
  return countryFeatures.flat();
}

/** Returns all available ADM1 polygons worldwide, cached as a single in-flight promise. */
export function loadAllFirstLevelBoundaries(): Promise<AdministrativeFeature[]> {
  if (!globalAdm1Promise) {
    globalAdm1Promise = loadGlobalAdm1().catch((error) => {
      globalAdm1Promise = null;
      throw error;
    });
  }
  return globalAdm1Promise;
}
