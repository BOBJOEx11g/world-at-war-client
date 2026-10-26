/**
 * Shared terrain vocabulary for World at War's client and future singleplayer mode.
 * These are descriptive tags only; movement and visibility effects are not implemented.
 */

export const BIOME_TAGS = [
  "forest",
  "rainforest",
  "grassland",
  "savanna",
  "desert",
  "shrubland",
  "tundra",
  "wetland",
] as const;

export const TERRAIN_OVERLAY_TAGS = [
  "mountains",
  "hills",
  "coastal",
  "urban",
  "riverine",
  "ice-snow",
] as const;

export const TERRAIN_TAGS = [
  ...BIOME_TAGS,
  ...TERRAIN_OVERLAY_TAGS,
] as const;

export type BiomeTag = (typeof BIOME_TAGS)[number];
export type TerrainOverlayTag = (typeof TERRAIN_OVERLAY_TAGS)[number];
export type TerrainTag = (typeof TERRAIN_TAGS)[number];

/** Province terrain data can be loaded by either singleplayer or multiplayer. */
export interface ProvinceTerrainData {
  provinceId: string;
  terrainTags: TerrainTag[];
  biomeSource?: {
    dataset: "RESOLVE Ecoregions 2017";
    version: string;
    sourceFeatureIds: string[];
    license: "CC BY 4.0";
  };
}

const VALID_TERRAIN_TAGS = new Set<string>(TERRAIN_TAGS);

export function isTerrainTag(value: string): value is TerrainTag {
  return VALID_TERRAIN_TAGS.has(value);
}

export function validateProvinceTerrain(data: ProvinceTerrainData): string[] {
  const errors: string[] = [];
  if (!data.provinceId.trim()) errors.push("Province terrain data needs a provinceId.");
  const seen = new Set<string>();
  for (const tag of data.terrainTags) {
    if (!isTerrainTag(tag)) errors.push(`Unknown terrain tag: ${tag}`);
    if (seen.has(tag)) errors.push(`Duplicate terrain tag: ${tag}`);
    seen.add(tag);
  }
  if (data.biomeSource && data.biomeSource.license !== "CC BY 4.0") {
    errors.push("Unexpected biome dataset licence.");
  }
  return errors;
}
