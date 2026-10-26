/**
 * Lazy-load first-level administrative boundaries (states/provinces).
 * Source: geoBoundaries gbOpen, CC BY 4.0. The API returns the current
 * source release metadata and a simplified GeoJSON download for each country.
 */

export type AdministrativeProperties = {
  shapeName?: string;
  shapeID?: string | number;
  shapeGroup?: string;
  shapeType?: string;
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
  simplifiedGeometryGeoJSON?: string;
  gjDownloadURL?: string;
};

const boundaryCache = new Map<string, AdministrativeFeatureCollection | null>();

export async function loadFirstLevelBoundaries(
  iso3: string,
): Promise<AdministrativeFeatureCollection | null> {
  const countryCode = iso3.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(countryCode)) return null;
  if (boundaryCache.has(countryCode)) return boundaryCache.get(countryCode) ?? null;

  const metadataResponse = await fetch(
    `https://www.geoboundaries.org/api/current/gbOpen/${countryCode}/ADM1/`,
    { headers: { accept: "application/json" } },
  );
  if (!metadataResponse.ok) {
    if (metadataResponse.status === 404) {
      boundaryCache.set(countryCode, null);
      return null;
    }
    throw new Error(`geoBoundaries metadata request failed for ${countryCode}: HTTP ${metadataResponse.status}`);
  }

  const metadata = (await metadataResponse.json()) as GeoBoundariesMetadata[] | GeoBoundariesMetadata;
  const entry = Array.isArray(metadata) ? metadata[0] : metadata;
  if (!entry) {
    boundaryCache.set(countryCode, null);
    return null;
  }
  const dataUrl = entry.simplifiedGeometryGeoJSON || entry.gjDownloadURL;
  if (!dataUrl) {
    boundaryCache.set(countryCode, null);
    return null;
  }

  const dataResponse = await fetch(dataUrl, {
    headers: { accept: "application/geo+json, application/json" },
  });
  if (!dataResponse.ok) {
    throw new Error(`geoBoundaries geometry request failed for ${countryCode}: HTTP ${dataResponse.status}`);
  }
  const collection = (await dataResponse.json()) as AdministrativeFeatureCollection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error(`geoBoundaries returned invalid ADM1 GeoJSON for ${countryCode}`);
  }

  const normalized: AdministrativeFeatureCollection = {
    ...collection,
    features: collection.features.map((feature, index) => ({
      ...feature,
      id: feature.id ?? feature.properties?.shapeID ?? `${countryCode}-ADM1-${index}`,
      properties: { ...(feature.properties ?? {}) },
    })),
  };
  boundaryCache.set(countryCode, normalized);
  return normalized;
}
