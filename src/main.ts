import { geoBounds, geoCentroid, geoContains, geoDistance, geoNaturalEarth1 } from "d3-geo";
import { BIOME_TAGS } from "./terrain";
import { WebGLMapRenderer } from "./webgl-renderer";
import { loadAllFirstLevelBoundaries, type AdministrativeFeature } from "./admin-boundaries";
import { buildStrategicGraph, type StrategicGraph } from "./world-graph";
import "./style.css";

// Vite resolves this local asset to a cache-busted production URL.
const waterTextureUrl = new URL("./water_texture.jpg", import.meta.url).href;

type CountryProperties = { name?: string; [key: string]: unknown };
type CountryFeature = GeoJSON.Feature<GeoJSON.Geometry, CountryProperties>;
type BiomeFeature = GeoJSON.Feature<GeoJSON.Geometry, { BIOME_NAME?: string; [key: string]: unknown }>;
type CityAreaProperties = { name?: string; NAME?: string; scalerank?: number; featurecla?: string; area_sqkm?: number; [key: string]: unknown };
type CityAreaFeature = GeoJSON.Feature<GeoJSON.Geometry, CityAreaProperties>;
type LakeFeature = GeoJSON.Feature<GeoJSON.Geometry, { name?: string; NAME?: string; [key: string]: unknown }>;
type CityRecord = { feature: CityAreaFeature; id: string; name: string; country: string; isCapital: boolean };

const BIOME_COLORS: Record<string, string> = {
  forest: "#7b9873",
  rainforest: "#557f68",
  grassland: "#b9ae78",
  savanna: "#c6a36b",
  desert: "#c6a078",
  shrubland: "#9b9c76",
  tundra: "#b7c1b5",
  wetland: "#7da69b",
};

function biomeTagForFeature(feature: BiomeFeature): string {
  const name = String(feature.properties?.BIOME_NAME ?? "").toLowerCase();
  if (name.includes("desert")) return "desert";
  if (name.includes("tundra") || name === "n/a") return "tundra";
  if (name.includes("flooded") || name.includes("mangrove")) return "wetland";
  if (name.includes("mediterranean") || name.includes("montane grassland")) return "shrubland";
  if (name.includes("tropical") && name.includes("grassland")) return "savanna";
  if (name.includes("temperate grassland") || name.includes("grasslands, savannas")) return "grassland";
  if (name.includes("moist broadleaf")) return "rainforest";
  return "forest";
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root element.");

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="World at War home"><span class="brand-mark">W</span><span>WORLD <b>AT WAR</b></span></a>
    <div class="scenario"><span class="status-dot"></span> MODERN WORLD <span class="scenario-year">2026</span></div>
    <div class="topbar-right"><span class="connection"><span class="status-dot muted"></span> SERVER NOT CONNECTED</span><button class="icon-button" id="about-button" aria-label="About this project">?</button></div>
  </header>
  <main class="layout">
    <aside class="sidebar">
      <div class="eyebrow">WORLD OVERVIEW</div>
      <h1>The world is<br/><em>in your hands.</em></h1>
      <p class="intro">A persistent, full-world grand strategy game. Territory is selected at province and city level.</p>
      <div class="stat-grid">
        <div class="stat"><span>SCENARIO</span><strong>2026</strong></div>
        <div class="stat"><span>MAP LAYER</span><strong>Provinces</strong></div>
        <div class="stat"><span>SERVER</span><strong class="warning-text">Offline</strong></div>
        <div class="stat"><span>MAP SOURCE</span><strong>Natural Earth*</strong></div>
      </div>
      <div class="section-heading">SELECTED TERRITORY <span class="live-label">MAP</span></div>
      <section class="selection-card" id="selection-card">
        <div class="selection-icon">◎</div>
        <div><h2 id="selected-name">Select a province or city</h2><p id="selected-detail">Click a state/province; zoom in to select urban footprints.</p></div>
      </section>
      <div class="section-heading">PROJECT STATUS</div>
      <ul class="status-list">
        <li><span class="status-check">✓</span><span>Client scaffold</span><span class="status-word">READY</span></li>
        <li><span class="status-check">✓</span><span>Selectable province polygons</span><span class="status-word">READY</span></li>
        <li><span class="status-check">✓</span><span>Selectable urban-area polygons</span><span class="status-word">READY</span></li>
        <li><span class="status-pending">•</span><span>Detailed provinces & islands</span><span class="status-word pending">IN PROGRESS</span></li>
        <li><span class="status-pending">•</span><span>Multiplayer server</span><span class="status-word pending">PLANNED</span></li>
      </ul>
      <div class="section-heading">SUPPORTED BIOMES <span class="live-label">8 TAGS</span></div>
      <div class="biome-tags" aria-label="Supported biome tags">${BIOME_TAGS.map((biome) => `<span class="biome-tag">${biome}</span>`).join("")}</div>
      <p class="biome-note">Toggle the biome map to view broad ecological regions. This is a reference overlay, not yet province-level game terrain data.</p>
      <div class="sidebar-note"><strong>*Map-data note</strong><p>Countries use Natural Earth Admin 0 geometry; states/provinces use Natural Earth 1:10m Admin 1. City polygons use Natural Earth 1:10m urban areas matched to nearby 1:10m populated places. Lakes use Natural Earth 1:10m lake polygons. Urban footprints are built-up areas, not official municipal borders. Optional biome overlay: RESOLVE Ecoregions 2017, CC BY 4.0.</p></div>
      <footer>WORLD AT WAR <span>·</span> EARLY DEVELOPMENT</footer>
    </aside>
    <section class="map-panel" aria-label="Interactive world map">
      <div class="map-toolbar"><div><span class="toolbar-kicker">STRATEGIC VIEW</span><strong>Global map</strong></div><div class="map-actions"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-caribbean">CARIBBEAN</button><button id="toggle-biomes" aria-pressed="false">BIOMES: OFF</button><button id="toggle-nodes" aria-pressed="false">NODES: OFF</button><button id="toggle-paths" aria-pressed="false">PATHS: OFF</button><button id="reset-view">RESET VIEW</button></div></div>
      <div class="map-wrap" id="map-wrap"><div class="map-loading" id="map-loading">Rendering world geometry…</div><canvas id="world-map-webgl" aria-hidden="true"></canvas><canvas id="strategic-graph-canvas" aria-hidden="true"></canvas><div id="map-input-layer" role="application" aria-label="Interactive world map. Use the mouse or touch to pan and zoom, and click a territory to select it." tabindex="0"></div><div class="map-legend" id="map-legend"><span><i class="legend-country"></i> Country</span><span><i class="legend-province"></i> State / province</span><span><i class="legend-selected"></i> Selected</span><span><i class="legend-ocean"></i> Ocean / lake</span></div><div class="map-coordinates">WORLD MAP · PROVISIONAL GEOGRAPHY</div></div>
      <div class="map-footer"><span id="map-status">Loading country geometry…</span><span>SCENARIO DATA: 2026 <i>·</i> MAP DATA: PROVISIONAL</span></div>
    </section>
  </main>
  <dialog id="about-dialog"><div class="dialog-top"><h2>World at War</h2><button id="close-about" aria-label="Close">×</button></div><p>This is the first interactive map scaffold for a larger grand-strategy project.</p><p>The map is for development and does not yet represent authoritative 2026 borders, playable nations, or province-level territory ownership.</p></dialog>
`;

const mapWrap = document.querySelector<HTMLDivElement>("#map-wrap")!;
const mapInput = document.querySelector<HTMLDivElement>("#map-input-layer")!;
const webglCanvas = document.querySelector<HTMLCanvasElement>("#world-map-webgl")!;
const strategicGraphCanvas = document.querySelector<HTMLCanvasElement>("#strategic-graph-canvas")!;
const strategicGraphContext = strategicGraphCanvas.getContext("2d");
let webglRenderer: WebGLMapRenderer | null = null;
let webglFailed = false;
let webglRenderFrame = 0;
const loading = document.querySelector<HTMLDivElement>("#map-loading")!;
const mapStatus = document.querySelector<HTMLSpanElement>("#map-status")!;
const selectedName = document.querySelector<HTMLHeadingElement>("#selected-name")!;
const selectedDetail = document.querySelector<HTMLParagraphElement>("#selected-detail")!;
const selectionCard = document.querySelector<HTMLElement>("#selection-card")!;

let zoomScale = 1;
let panX = 0;
let panY = 0;
let mapProjection: ReturnType<typeof geoNaturalEarth1> | null = null;
let projectedWidth = 0;
let projectedHeight = 0;
let projectedCountries: CountryFeature[] | null = null;
let projectedAdministrative: AdministrativeFeature[] | null = null;
let projectedLakes: LakeFeature[] | null = null;
let projectedCities: CityAreaFeature[] | null = null;
let projectedBiomes: BiomeFeature[] | null = null;
let projectedBiomeMode: boolean | null = null;

type SpatialIndex = {
  cells: Map<string, GeoJSON.Feature<GeoJSON.Geometry>[]>;
  global: GeoJSON.Feature<GeoJSON.Geometry>[];
};
const SPATIAL_CELL_DEGREES = 10;
let administrativeSpatialIndex: SpatialIndex = { cells: new Map(), global: [] };
let citySpatialIndex: SpatialIndex = { cells: new Map(), global: [] };

function spatialCellKey(longitude: number, latitude: number): string {
  const x = Math.max(0, Math.min(35, Math.floor((longitude + 180) / SPATIAL_CELL_DEGREES)));
  const y = Math.max(0, Math.min(17, Math.floor((latitude + 90) / SPATIAL_CELL_DEGREES)));
  return `${x}:${y}`;
}

function buildSpatialIndex(features: GeoJSON.Feature<GeoJSON.Geometry>[]): SpatialIndex {
  const index: SpatialIndex = { cells: new Map(), global: [] };
  for (const feature of features) {
    try {
      const bounds = geoBounds(feature);
      const west = bounds[0][0], south = bounds[0][1], east = bounds[1][0], north = bounds[1][1];
      const longitudeRanges: Array<[number, number]> = east < west ? [[west, 180], [-180, east]] : [[west, east]];
      let keys: string[] = [];
      for (const [rangeWest, rangeEast] of longitudeRanges) {
        const minX = Math.max(0, Math.min(35, Math.floor((rangeWest + 180) / SPATIAL_CELL_DEGREES)));
        const maxX = Math.max(0, Math.min(35, Math.floor((rangeEast + 180) / SPATIAL_CELL_DEGREES)));
        const minY = Math.max(0, Math.min(17, Math.floor((south + 90) / SPATIAL_CELL_DEGREES)));
        const maxY = Math.max(0, Math.min(17, Math.floor((north + 90) / SPATIAL_CELL_DEGREES)));
        for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) keys.push(`${x}:${y}`);
      }
      keys = [...new Set(keys)];
      if (keys.length > 180) { index.global.push(feature); continue; }
      for (const key of keys) {
        const bucket = index.cells.get(key) ?? [];
        bucket.push(feature);
        index.cells.set(key, bucket);
      }
    } catch {
      index.global.push(feature);
    }
  }
  return index;
}

function spatialCandidates(index: SpatialIndex, longitude: number, latitude: number): GeoJSON.Feature<GeoJSON.Geometry>[] {
  const bucket = index.cells.get(spatialCellKey(longitude, latitude)) ?? [];
  return bucket.length || index.global.length ? [...bucket, ...index.global] : [];
}

function colorToRgba(hex: string): [number, number, number, number] {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, 0.44];
}
let isPanning = false;
let pointerStartX = 0;
let pointerStartY = 0;
let panStartX = 0;
let panStartY = 0;
let didPan = false;
let suppressNextClick = false;
let viewWidth = 1200;
let viewHeight = 650;
let countryFeatures: CountryFeature[] = [];
let allAdministrativeFeatures: AdministrativeFeature[] = [];
let administrativeDataReady = false;
let cityAreaFeatures: CityAreaFeature[] = [];
let cityRecords: CityRecord[] = [];
let cityRecordsById = new Map<string, CityRecord>();
let cityRecordByFeature = new WeakMap<object, CityRecord>();
let lakeFeatures: LakeFeature[] = [];
let cityDataReady = false;
let selectedProvinceId: string | null = null;
let strategicGraph: StrategicGraph | null = null;
let nodesModeEnabled = false;
let pathsModeEnabled = false;
let selectedCityId: string | null = null;
let biomeModeEnabled = false;
let biomeFeatures: BiomeFeature[] = [];
let biomeDataPromise: Promise<BiomeFeature[]> | null = null;
const biomeToggle = document.querySelector<HTMLButtonElement>("#toggle-biomes")!;
const mapLegend = document.querySelector<HTMLDivElement>("#map-legend")!;
const nodesToggle = document.querySelector<HTMLButtonElement>("#toggle-nodes")!;
const pathsToggle = document.querySelector<HTMLButtonElement>("#toggle-paths")!;

// Generalize the global ecoregion geometry slightly: this is a broad map overlay,
// not navigation-grade data, and smaller paths render much faster in the browser.
const CITY_AREAS_GEOJSON_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_urban_areas.geojson";
const POPULATED_PLACES_GEOJSON_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson";
const LAKES_GEOJSON_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson";

const BIOME_GEOJSON_URL =
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Resolve_Ecoregions/FeatureServer/0/query?where=1%3D1&outFields=BIOME_NAME&returnGeometry=true&outSR=4326&maxAllowableOffset=0.02&geometryPrecision=4&resultRecordCount=1000&f=geojson";

type CityWorkerResult =
  | { type: "success"; areas: CityAreaFeature[]; records: Array<{ index: number; id: string; name: string; country: string }>; indexCells: Array<[string, number[]]>; globalIndices: number[] }
  | { type: "error"; message: string };

async function loadCityGeometry(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("./city-data-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<CityWorkerResult>) => {
      worker.terminate();
      const result = event.data;
      if (result.type === "error") { reject(new Error(result.message)); return; }
      cityAreaFeatures = result.areas as CityAreaFeature[];
      cityRecords = result.records.map((record) => ({
        feature: cityAreaFeatures[record.index]!,
        id: record.id,
        name: record.name,
        country: record.country,
        isCapital: record.isCapital,
      }));
      cityRecordsById = new Map(cityRecords.map((record) => [record.id, record] as const));
      cityRecordByFeature = new WeakMap(cityRecords.map((record) => [record.feature, record] as const));
      citySpatialIndex = {
        cells: new Map(result.indexCells.map(([key, indices]) => [key, indices.map((index) => cityAreaFeatures[index]!).filter(Boolean)] as const)),
        global: result.globalIndices.map((index) => cityAreaFeatures[index]!).filter(Boolean),
      };
      cityDataReady = true;
      rebuildStrategicGraph();
      resolve();
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The city-data worker failed before returning its geometry."));
    };
    worker.postMessage({ areasUrl: CITY_AREAS_GEOJSON_URL, placesUrl: POPULATED_PLACES_GEOJSON_URL });
  });
}

async function loadLakeGeometry(): Promise<void> {
  const response = await fetch(LAKES_GEOJSON_URL, { headers: { accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Lake data request failed: HTTP ${response.status}`);
  const dataset = await response.json() as GeoJSON.FeatureCollection<GeoJSON.Geometry, LakeFeature["properties"]>;
  if (dataset.type !== "FeatureCollection" || !Array.isArray(dataset.features) || dataset.features.length === 0) throw new Error("Lake source did not return a valid GeoJSON FeatureCollection.");
  lakeFeatures = dataset.features as LakeFeature[];
}

async function loadBiomeGeometry(): Promise<BiomeFeature[]> {
  const response = await fetch(BIOME_GEOJSON_URL, {
    headers: { accept: "application/geo+json, application/json" },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Biome data request failed: HTTP ${response.status}`);
  const dataset = (await response.json()) as { type?: string; features?: BiomeFeature[] };
  if (dataset.type !== "FeatureCollection" || !Array.isArray(dataset.features) || dataset.features.length === 0) {
    throw new Error("Biome source did not return a valid GeoJSON FeatureCollection.");
  }
  return dataset.features;
}

function loadBiomeGeometryOnce(): Promise<BiomeFeature[]> {
  if (!biomeDataPromise) {
    biomeDataPromise = loadBiomeGeometry().catch((error) => {
      biomeDataPromise = null;
      throw error;
    });
  }
  return biomeDataPromise;
}

const ADMIN0_GEOJSON_URL =
  "https://raw.githubusercontent.com/datasets/geo-countries/ca3b7150caa5d3cc3fb108a87fc6e3d57bd97d99/data/countries.geojson";
let countryCollection: GeoJSON.FeatureCollection<GeoJSON.Geometry, CountryProperties> = {
  type: "FeatureCollection",
  features: [],
};

function stableCountryId(name: string, properties: CountryProperties): string {
  const iso3 = properties["ISO3166-1-Alpha-3"];
  if (typeof iso3 === "string" && iso3.trim() && iso3 !== "-99") return iso3;
  const slug = name
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `NE-${slug || "unknown"}`;
}

async function loadCountryGeometry(): Promise<void> {
  try {
    const response = await fetch(ADMIN0_GEOJSON_URL, {
      headers: { accept: "application/geo+json, application/json" },
    });
    if (!response.ok) throw new Error(`Country data request failed: HTTP ${response.status}`);
    const dataset = (await response.json()) as {
      type?: string;
      features?: CountryFeature[];
    };
    if (dataset.type !== "FeatureCollection" || !Array.isArray(dataset.features)) {
      throw new Error("Country data is not a GeoJSON FeatureCollection.");
    }
    if (dataset.features.length !== 258) {
      throw new Error(`Expected 258 Natural Earth Admin 0 countries; received ${dataset.features.length}.`);
    }
    countryFeatures = dataset.features.map((feature) => {
      const properties = feature.properties ?? {};
      const name = typeof properties.name === "string" ? properties.name.trim() : "";
      return {
        ...feature,
        id: stableCountryId(name, properties),
        properties: { ...properties, name },
      } as CountryFeature;
    });
    countryCollection = { type: "FeatureCollection", features: countryFeatures };
    renderMap();
  } catch (error) {
    loading.hidden = false;
    loading.textContent = "Unable to load 1:10m country geometry";
    mapStatus.textContent = "Country data failed to load. Check the connection and refresh.";
    console.error("World at War country geometry failed to load:", error);
  }
}

function renderMap(): void {
  const bounds = mapWrap.getBoundingClientRect();
  viewWidth = Math.max(1, Math.floor(bounds.width));
  viewHeight = Math.max(1, Math.floor(bounds.height));
  if (viewWidth <= 1 || viewHeight <= 1 || countryCollection.features.length === 0) return;

  // All map pixels are rendered by WebGL; this HTML layer only receives input.
  const projection = geoNaturalEarth1()
    .fitExtent([[18, 24], [Math.max(19, viewWidth - 18), Math.max(25, viewHeight - 28)]], countryCollection);
  mapProjection = projection;

  const projectionChanged = projectedWidth !== viewWidth || projectedHeight !== viewHeight;
  const project = (coordinate: GeoJSON.Position): [number, number] | null => {
    const point = projection(coordinate as [number, number]);
    return point && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? [point[0], point[1]] : null;
  };

  try {
    if (webglFailed) throw new Error("WebGL initialization previously failed.");
    if (!webglRenderer) webglRenderer = new WebGLMapRenderer(webglCanvas);
    webglRenderer.resize(viewWidth, viewHeight);

    if (projectionChanged || projectedCountries !== countryFeatures) {
      webglRenderer.setGeometry(countryFeatures, project);
      projectedCountries = countryFeatures;
    }
    if (projectionChanged || projectedAdministrative !== allAdministrativeFeatures) {
      webglRenderer.setAdministrativeGeometry(allAdministrativeFeatures, project);
      projectedAdministrative = allAdministrativeFeatures;
    }
    if (projectionChanged || projectedLakes !== lakeFeatures) {
      webglRenderer.setLakeGeometry(lakeFeatures, project);
      projectedLakes = lakeFeatures;
    }
    if (zoomScale >= 4 && (projectionChanged || projectedCities !== cityAreaFeatures)) {
      webglRenderer.setCityGeometry(cityAreaFeatures, project);
      projectedCities = cityAreaFeatures;
    } else if (projectionChanged || projectedCities !== cityAreaFeatures) {
      // Delay expensive urban triangulation until the player actually zooms in.
      projectedCities = null;
    }
    if (projectionChanged || projectedBiomes !== biomeFeatures || projectedBiomeMode !== biomeModeEnabled) {
      webglRenderer.setBiomeGeometry(
        biomeModeEnabled ? biomeFeatures : [],
        project,
        (feature) => {
          const biome = biomeTagForFeature(feature as BiomeFeature);
          return { key: biome, color: colorToRgba(BIOME_COLORS[biome] ?? "#9b927e") };
        },
      );
      projectedBiomes = biomeFeatures;
      projectedBiomeMode = biomeModeEnabled;
    }
    projectedWidth = viewWidth;
    projectedHeight = viewHeight;

    let selectedFeature: GeoJSON.Feature<GeoJSON.Geometry> | null = null;
    if (selectedCityId) selectedFeature = cityRecordsById.get(selectedCityId)?.feature ?? null;
    else if (selectedProvinceId) {
      selectedFeature = allAdministrativeFeatures.find((feature) =>
        String(feature.id ?? feature.properties.shapeID ?? feature.properties.shapeName ?? "unknown") === selectedProvinceId
      ) ?? null;
    }
    webglRenderer.setSelection(selectedFeature, project);
    webglCanvas.hidden = false;
    webglRenderer.render(viewWidth, viewHeight, panX, panY, zoomScale);
    drawStrategicGraph();
  } catch (error) {
    webglFailed = true;
    webglCanvas.hidden = false;
    console.error("World at War WebGL renderer failed:", error);
    mapStatus.textContent = "WebGL map rendering failed. This browser/device may not support the required renderer.";
  }

  loading.hidden = true;
  if (webglFailed) return;
  mapStatus.textContent = administrativeDataReady
    ? `${countryFeatures.length.toLocaleString()} countries · ${allAdministrativeFeatures.length.toLocaleString()} state/province polygons · ${cityDataReady ? `${cityRecords.length.toLocaleString()} urban footprints` : "loading urban areas…"}`
    : `${countryFeatures.length.toLocaleString()} countries · loading global state/province polygons…`;
}

function selectCity(id: string, name: string, country: string): void {
  selectedCityId = id;
  selectedProvinceId = null;
  selectedName.textContent = name;
  selectedDetail.textContent = `${name} · ${country}. Urban footprint selected; this is built-up-area geography, not an official municipal boundary.`;
  selectionCard.classList.add("has-selection");
  const record = cityRecordsById.get(id);
  if (webglRenderer && mapProjection) {
    webglRenderer.setSelection(record?.feature ?? null, (coordinate) => {
      const point = mapProjection!(coordinate as [number, number]);
      return point ? [point[0], point[1]] : null;
    });
    scheduleWebGLRender();
  }
  mapStatus.textContent = `Selected urban area: ${name} · ${country}`;
}

function selectProvince(id: string): void {
  const mergedCity = strategicGraph
    ? [...strategicGraph.replacedProvinceByCityId.entries()].find(([, provinceId]) => provinceId === id)
    : undefined;
  if (mergedCity) {
    const city = cityRecordsById.get(mergedCity[0]);
    if (city) { selectCity(city.id, city.name, city.country); return; }
  }
  selectedCityId = null;
  selectedProvinceId = id;
  const province = allAdministrativeFeatures.find((feature) =>
    String(feature.id ?? feature.properties.shapeID ?? feature.properties.shapeName ?? "unknown") === id
  );
  if (!province) return;
  const provinceName = String(province.properties.shapeName ?? "Unnamed state/province");
  const parentCode = province.properties.parentCountryId;
  const country = countryFeatures.find((feature) =>
    String(feature.id ?? feature.properties.name ?? "unknown") === parentCode
  );
  const countryName = country?.properties.name ?? String(province.properties.admin ?? parentCode ?? "Country unavailable");
  selectedName.textContent = provinceName;
  selectedDetail.textContent = `${provinceName} · ${countryName}. State/province polygon selected.`;
  selectionCard.classList.add("has-selection");
  if (webglRenderer && mapProjection) {
    webglRenderer.setSelection(province, (coordinate) => {
      const point = mapProjection!(coordinate as [number, number]);
      return point ? [point[0], point[1]] : null;
    });
    scheduleWebGLRender();
  }
  mapStatus.textContent = `Selected state/province: ${provinceName} · ${countryName}`;
}

function rebuildStrategicGraph(): void {
  if (!administrativeDataReady || !cityDataReady || strategicGraph) return;
  try {
    strategicGraph = buildStrategicGraph(allAdministrativeFeatures, cityRecords.map((record) => ({
      id: record.id,
      name: record.name,
      country: record.country,
      isCapital: record.isCapital,
      feature: record.feature,
    })));
    drawStrategicGraph();
    mapStatus.textContent = `Strategic graph ready · ${strategicGraph.nodes.length.toLocaleString()} nodes · ${strategicGraph.paths.length.toLocaleString()} provisional paths`;
  } catch (error) {
    console.error("Strategic node/path graph failed to build:", error);
    mapStatus.textContent = "Strategic graph failed to build; map layers remain available.";
  }
}

function drawStrategicGraph(): void {
  const context = strategicGraphContext;
  if (!context) return;
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(viewWidth));
  const height = Math.max(1, Math.floor(viewHeight));
  if (strategicGraphCanvas.width !== Math.floor(width * pixelRatio) ||
      strategicGraphCanvas.height !== Math.floor(height * pixelRatio)) {
    strategicGraphCanvas.width = Math.floor(width * pixelRatio);
    strategicGraphCanvas.height = Math.floor(height * pixelRatio);
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!strategicGraph || (!nodesModeEnabled && !pathsModeEnabled) || !mapProjection) return;

  const projected = new Map<string, [number, number]>();
  for (const node of strategicGraph.nodes) {
    const point = mapProjection([node.longitude, node.latitude]);
    if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
      projected.set(node.id, [point[0] * zoomScale + panX, point[1] * zoomScale + panY]);
    }
  }

  if (pathsModeEnabled) {
    context.save();
    context.strokeStyle = "rgba(35, 36, 31, 0.66)";
    context.lineWidth = Math.max(0.7, Math.min(1.5, zoomScale * 0.16));
    context.setLineDash([4, 3]);
    context.beginPath();
    for (const path of strategicGraph.paths) {
      const from = projected.get(path.from), to = projected.get(path.to);
      if (!from || !to) continue;
      if (Math.max(from[0], to[0]) < -40 || Math.min(from[0], to[0]) > width + 40 ||
          Math.max(from[1], to[1]) < -40 || Math.min(from[1], to[1]) > height + 40) continue;
      context.moveTo(from[0], from[1]);
      if (path.via && mapProjection) {
        const via = mapProjection(path.via);
        if (via) context.lineTo(via[0] * zoomScale + panX, via[1] * zoomScale + panY);
      }
      context.lineTo(to[0], to[1]);
    }
    context.stroke();
    context.restore();
  }

  if (nodesModeEnabled) {
    for (const node of strategicGraph.nodes) {
      if (node.kind === "province" && zoomScale < 2.5) continue;
      if (node.kind === "city" && zoomScale < 4) continue;
      const point = projected.get(node.id);
      if (!point || point[0] < -12 || point[0] > width + 12 || point[1] < -12 || point[1] > height + 12) continue;
      context.beginPath();
      context.arc(point[0], point[1], node.isCapital ? 4.5 : node.kind === "city" ? 2.8 : 2.1, 0, Math.PI * 2);
      context.fillStyle = node.isCapital ? "#e8ad43" : node.kind === "city" ? "#7b322d" : "#282923";
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = "#f0e4c7";
      context.stroke();
    }
  }
}

function scheduleWebGLRender(): void {
  if (webglRenderFrame) return;
  webglRenderFrame = requestAnimationFrame(() => {
    webglRenderFrame = 0;
    if (!webglRenderer || webglFailed) return;
    if (zoomScale >= 4 && cityDataReady && projectedCities !== cityAreaFeatures && mapProjection) {
      webglRenderer.setCityGeometry(cityAreaFeatures, (coordinate) => {
        const point = mapProjection!(coordinate as [number, number]);
        return point ? [point[0], point[1]] : null;
      });
      projectedCities = cityAreaFeatures;
    }
    webglRenderer.render(viewWidth, viewHeight, panX, panY, zoomScale);
    drawStrategicGraph();
  });
}

function applyViewTransform(_animate = true): void {
  scheduleWebGLRender();
}

function zoomAt(screenX: number, screenY: number, factor: number): void {
  const nextScale = Math.max(1, Math.min(1000, zoomScale * factor));
  if (nextScale === zoomScale) return;
  const mapX = (screenX - panX) / zoomScale;
  const mapY = (screenY - panY) / zoomScale;
  panX = screenX - mapX * nextScale;
  panY = screenY - mapY * nextScale;
  zoomScale = nextScale;
  applyViewTransform();
}

function zoomAtCenter(factor: number): void {
  zoomAt(viewWidth / 2, viewHeight / 2, factor);
}

function focusMapCoordinate(longitude: number, latitude: number, scale: number): void {
  if (!mapProjection) return;
  const projected = mapProjection([longitude, latitude]);
  if (!projected) return;
  zoomScale = Math.max(1, Math.min(1000, scale));
  panX = viewWidth / 2 - projected[0] * zoomScale;
  panY = viewHeight / 2 - projected[1] * zoomScale;
  applyViewTransform();
}

document.querySelector("#zoom-in")?.addEventListener("click", () => zoomAtCenter(1.6));
document.querySelector("#zoom-out")?.addEventListener("click", () => zoomAtCenter(1 / 1.6));
document.querySelector("#zoom-caribbean")?.addEventListener("click", () => focusMapCoordinate(-68, 17, 5.5));

nodesToggle.addEventListener("click", () => {
  nodesModeEnabled = !nodesModeEnabled;
  nodesToggle.textContent = nodesModeEnabled ? "NODES: ON" : "NODES: OFF";
  nodesToggle.setAttribute("aria-pressed", String(nodesModeEnabled));
  nodesToggle.classList.toggle("is-active", nodesModeEnabled);
  drawStrategicGraph();
});
pathsToggle.addEventListener("click", () => {
  pathsModeEnabled = !pathsModeEnabled;
  pathsToggle.textContent = pathsModeEnabled ? "PATHS: ON" : "PATHS: OFF";
  pathsToggle.setAttribute("aria-pressed", String(pathsModeEnabled));
  pathsToggle.classList.toggle("is-active", pathsModeEnabled);
  drawStrategicGraph();
});

function updateBiomeLegend(): void {
  if (!biomeModeEnabled) {
    mapLegend.innerHTML = '<span><i class="legend-country"></i> Country</span><span><i class="legend-province"></i> State / province</span><span><i class="legend-selected"></i> Selected</span><span><i class="legend-ocean"></i> Ocean / lake</span>';
    return;
  }
  mapLegend.innerHTML = Object.entries(BIOME_COLORS)
    .map(([biome, color]) => `<span><i class="legend-biome" style="background:${color}"></i> ${biome}</span>`)
    .join("") + '<span><i class="legend-province"></i> Province border</span>';
}

biomeToggle.addEventListener("click", async () => {
  if (biomeModeEnabled) {
    biomeModeEnabled = false;
    biomeToggle.textContent = "BIOMES: OFF";
    biomeToggle.setAttribute("aria-pressed", "false");
    biomeToggle.classList.remove("is-active");
    updateBiomeLegend();
    renderMap();
    return;
  }

  biomeToggle.disabled = true;
  biomeToggle.textContent = "LOADING BIOMES…";
  mapStatus.textContent = "Loading RESOLVE 2017 biome polygons…";
  try {
    biomeFeatures = await loadBiomeGeometryOnce();
    biomeModeEnabled = true;
    biomeToggle.textContent = "BIOMES: ON";
    biomeToggle.setAttribute("aria-pressed", "true");
    biomeToggle.classList.add("is-active");
    updateBiomeLegend();
    renderMap();
    mapStatus.textContent = `Biome overlay on · ${biomeFeatures.length.toLocaleString()} ecological regions · province borders retained`;
  } catch (error) {
    console.error("World at War biome geometry failed to load:", error);
    biomeToggle.textContent = "BIOMES: RETRY";
    mapStatus.textContent = "Biome overlay failed to load. Check the connection and try again.";
  } finally {
    biomeToggle.disabled = false;
  }
});
document.querySelector("#reset-view")?.addEventListener("click", () => {
  zoomScale = 1;
  panX = 0;
  panY = 0;
  applyViewTransform();
});

mapInput.addEventListener("click", (event: MouseEvent) => {
  if (suppressNextClick || !mapProjection?.invert) return;
  const bounds = mapInput.getBoundingClientRect();
  const longitudeLatitude = mapProjection.invert([
    (event.clientX - bounds.left - panX) / zoomScale,
    (event.clientY - bounds.top - panY) / zoomScale,
  ]);
  if (!longitudeLatitude || !longitudeLatitude.every(Number.isFinite)) return;
  const [longitude, latitude] = longitudeLatitude;

  if (zoomScale >= 4 && cityDataReady) {
    const candidates = spatialCandidates(citySpatialIndex, longitude, latitude);
    for (let i = candidates.length - 1; i >= 0; i--) {
      const feature = candidates[i]!;
      if (!geoContains(feature, [longitude, latitude])) continue;
      const record = cityRecordByFeature.get(feature);
      if (record) { selectCity(record.id, record.name, record.country); return; }
    }
  }

  if (administrativeDataReady) {
    const candidates = spatialCandidates(administrativeSpatialIndex, longitude, latitude);
    for (let i = candidates.length - 1; i >= 0; i--) {
      const feature = candidates[i]!;
      if (!geoContains(feature, [longitude, latitude])) continue;
      const admin = feature as AdministrativeFeature;
      const id = String(admin.id ?? admin.properties.shapeID ?? admin.properties.shapeName ?? "unknown");
      selectProvince(id);
      return;
    }
  }
}, false);

mapInput.addEventListener("wheel", (event: WheelEvent) => {
  event.preventDefault();
  const bounds = mapInput.getBoundingClientRect();
  zoomAt(event.clientX - bounds.left, event.clientY - bounds.top, event.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

const activeTouchPointers = new Map<number, { x: number; y: number }>();

mapInput.addEventListener("pointerdown", (event: PointerEvent) => {
  if (event.pointerType === "touch") {
    activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    suppressNextClick = false;
    if (activeTouchPointers.size >= 2) {
      // A second finger switches from panning to pinch-zooming without page scrolling.
      isPanning = false;
      didPan = true;
      suppressNextClick = true;
    }
  }
  if (event.button !== 0 && event.pointerType !== "touch") return;
  if (activeTouchPointers.size >= 2) return;
  isPanning = true;
  didPan = false;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  panStartX = panX;
  panStartY = panY;
});

window.addEventListener("pointermove", (event: PointerEvent) => {
  if (event.pointerType === "touch" && activeTouchPointers.has(event.pointerId)) {
    const previous = activeTouchPointers.get(event.pointerId)!;
    activeTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeTouchPointers.size >= 2) {
      const points = [...activeTouchPointers.values()];
      const first = points[0]!;
      const second = points[1]!;
      const oldDistance = Math.hypot(previous.x - second.x, previous.y - second.y);
      const newDistance = Math.hypot(first.x - second.x, first.y - second.y);
      // Recalculate the previous distance from the other finger's last position
      // when this pointer moved, so pinch zoom remains stable and focal-point anchored.
      const priorFirst = { x: previous.x, y: previous.y };
      const priorSecond = second;
      const distanceBefore = Math.max(1, Math.hypot(priorFirst.x - priorSecond.x, priorFirst.y - priorSecond.y));
      const distanceAfter = Math.max(1, newDistance);
      const bounds = mapInput.getBoundingClientRect();
      const midpointX = (first.x + second.x) / 2 - bounds.left;
      const midpointY = (first.y + second.y) / 2 - bounds.top;
      if (Number.isFinite(distanceBefore / distanceAfter) && oldDistance >= 0) {
        zoomAt(midpointX, midpointY, distanceAfter / distanceBefore);
      }
      isPanning = false;
      didPan = true;
      suppressNextClick = true;
      return;
    }
  }
  if (!isPanning) return;
  const dx = event.clientX - pointerStartX;
  const dy = event.clientY - pointerStartY;
  if (Math.abs(dx) + Math.abs(dy) > 4) didPan = true;
  if (!didPan) return;
  panX = panStartX + dx;
  panY = panStartY + dy;
  applyViewTransform(false);
});

function finishPan(event: PointerEvent): void {
  if (event.pointerType === "touch") activeTouchPointers.delete(event.pointerId);
  if (!isPanning) {
    if (activeTouchPointers.size === 1) {
      const remaining = [...activeTouchPointers.entries()][0]!;
      pointerStartX = remaining[1].x;
      pointerStartY = remaining[1].y;
      panStartX = panX;
      panStartY = panY;
      isPanning = true;
      didPan = true;
    }
    suppressNextClick = true;
    return;
  }
  isPanning = false;
  if (didPan) suppressNextClick = true;
}

window.addEventListener("pointerup", finishPan);
window.addEventListener("pointercancel", finishPan);
mapInput.addEventListener("click", (event: MouseEvent) => {
  if (!suppressNextClick) return;
  suppressNextClick = false;
  event.preventDefault();
  event.stopPropagation();
}, true);
document.querySelector("#about-button")?.addEventListener("click", () => (document.querySelector<HTMLDialogElement>("#about-dialog")!).showModal());
document.querySelector("#close-about")?.addEventListener("click", () => document.querySelector<HTMLDialogElement>("#about-dialog")!.close());

let resizeFrame = 0;
const resizeObserver = new ResizeObserver(() => {
  // Coalesce resize events; geometry is only reprojected when dimensions change.
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    renderMap();
  });
});
resizeObserver.observe(mapWrap);
loadCountryGeometry();
void loadLakeGeometry()
  .then(() => { renderMap(); mapStatus.textContent = `Lake layer ready · ${lakeFeatures.length.toLocaleString()} lake polygons`; })
  .catch((error) => { console.error("World at War lake geometry failed to load:", error); mapStatus.textContent = "Lake data failed to load; land and province layers remain available."; });
void loadCityGeometry()
  .then(() => {
    renderMap();
    mapStatus.textContent = `Urban-area layer ready · ${cityRecords.length.toLocaleString()} selectable footprints matched from ${cityAreaFeatures.length.toLocaleString()} shapes; zoom in to select cities`;
  })
  .catch((error) => {
    console.error("World at War urban-area geometry failed to load:", error);
    mapStatus.textContent = "Urban-area data failed to load; country and province selection still works.";
  });
void loadAllFirstLevelBoundaries()
  .then((features) => {
    allAdministrativeFeatures = features;
    administrativeSpatialIndex = buildSpatialIndex(features as GeoJSON.Feature<GeoJSON.Geometry>[]);
    administrativeDataReady = true;
    rebuildStrategicGraph();
    renderMap();
    mapStatus.textContent = "Global state/province layer visible · " + allAdministrativeFeatures.length.toLocaleString() + " polygons" + (cityDataReady ? ` · ${cityAreaFeatures.length.toLocaleString()} urban footprints loaded` : " · urban areas loading…");
  })
  .catch((error) => {
    console.error("World at War global administrative geography failed to load:", error);
    administrativeDataReady = false;
    mapStatus.textContent = "Global state/province data failed to load. Check the connection and refresh.";
    selectedDetail.textContent = "Global state/province boundaries failed to load. Check the connection and refresh.";
  });
