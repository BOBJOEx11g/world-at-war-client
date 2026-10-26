/**
 * Loads a single global first-level administrative polygon dataset.
 * A single GeoJSON request avoids hundreds of country-by-country requests,
 * which were unreliable and delayed the map layer from appearing.
 * Source: Natural Earth 1:10m Admin 1 States/Provinces, public-domain geography.
 * https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/
 */

export type AdministrativeProperties = {
  name?: string;
  NAME?: string;
  name_en?: string;
  shapeName?: string;
  shapeID?: string | number;
  shapeGroup?: string;
  shapeType?: string;
  admin?: string;
  adm0_a3?: string;
  ADM0_A3?: string;
  iso_3166_2?: string;
  iso_3166_2_code?: string;
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

const ADMIN1_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";

let globalAdm1Promise: Promise<AdministrativeFeature[]> | null = null;

function cleanCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) && code !== "-99" ? code : null;
}

function stableRegionId(feature: AdministrativeFeature, index: number): string {
  const props = feature.properties ?? {};
  const countryCode = cleanCode(props.adm0_a3) ?? cleanCode(props.ADM0_A3) ?? "UNK";
  const subdivisionCode = props.iso_3166_2 ?? props.iso_3166_2_code;
  if (typeof subdivisionCode === "string" && subdivisionCode.trim()) {
    return subdivisionCode.trim().toUpperCase();
  }
  const sourceId = feature.id ?? props.shapeID;
  if (sourceId !== undefined && sourceId !== null && String(sourceId).trim()) {
    return `${countryCode}-ADM1-${String(sourceId).trim()}`;
  }
  const name = String(props.name ?? props.NAME ?? props.shapeName ?? "unnamed")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${countryCode}-ADM1-${name || index}`;
}

async function loadGlobalAdm1(): Promise<AdministrativeFeature[]> {
  const response = await fetch(ADMIN1_GEOJSON_URL, {
    headers: { accept: "application/geo+json, application/json" },
  });
  if (!response.ok) {
    throw new Error(`Global state/province request failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as AdministrativeFeatureCollection;
  if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error("Global state/province source did not return a GeoJSON FeatureCollection.");
  }
  const features = payload.features.map((feature, index) => {
    const properties = feature.properties ?? {};
    const parentCountryId = cleanCode(properties.adm0_a3) ?? cleanCode(properties.ADM0_A3) ?? "UNK";
    const shapeName = String(properties.name ?? properties.NAME ?? properties.shapeName ?? "Unnamed state/province");
    return {
      ...feature,
      id: stableRegionId(feature, index),
      properties: {
        ...properties,
        shapeName,
        parentCountryId,
        administrativeLevel: "state-province" as const,
        sourceBoundaryId: "Natural Earth 1:10m Admin 1",
      },
    };
  });
  if (features.length === 0) {
    throw new Error("Global state/province source returned zero administrative polygons.");
  }
  return features;
}

/** Returns all available first-level administrative polygons worldwide. */
export function loadAllFirstLevelBoundaries(): Promise<AdministrativeFeature[]> {
  if (!globalAdm1Promise) {
    globalAdm1Promise = loadGlobalAdm1().catch((error) => {
      globalAdm1Promise = null;
      throw error;
    });
  }
  return globalAdm1Promise;
}
