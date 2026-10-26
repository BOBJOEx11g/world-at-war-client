import { geoNaturalEarth1, geoPath } from "d3-geo";
import { BIOME_TAGS } from "./terrain";
import { loadAllFirstLevelBoundaries, type AdministrativeFeature } from "./admin-boundaries";
import "./style.css";

type CountryProperties = { name?: string; [key: string]: unknown };
type CountryFeature = GeoJSON.Feature<GeoJSON.Geometry, CountryProperties>;

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
      <p class="intro">A persistent, full-world grand strategy game. Every nation has a place on the map.</p>
      <div class="stat-grid">
        <div class="stat"><span>SCENARIO</span><strong>2026</strong></div>
        <div class="stat"><span>MAP LAYER</span><strong>Countries</strong></div>
        <div class="stat"><span>SERVER</span><strong class="warning-text">Offline</strong></div>
        <div class="stat"><span>MAP SOURCE</span><strong>Natural Earth*</strong></div>
      </div>
      <div class="section-heading">SELECTED TERRITORY <span class="live-label">MAP</span></div>
      <section class="selection-card" id="selection-card">
        <div class="selection-icon">◎</div>
        <div><h2 id="selected-name">Select a country</h2><p id="selected-detail">Click any country on the map to inspect it.</p></div>
      </section>
      <div class="section-heading">PROJECT STATUS</div>
      <ul class="status-list">
        <li><span class="status-check">✓</span><span>Client scaffold</span><span class="status-word">READY</span></li>
        <li><span class="status-check">✓</span><span>Interactive country map</span><span class="status-word">READY</span></li>
        <li><span class="status-pending">•</span><span>Detailed provinces & islands</span><span class="status-word pending">IN PROGRESS</span></li>
        <li><span class="status-pending">•</span><span>Multiplayer server</span><span class="status-word pending">PLANNED</span></li>
      </ul>
      <div class="section-heading">SUPPORTED BIOMES <span class="live-label">8 TAGS</span></div>
      <div class="biome-tags" aria-label="Supported biome tags">${BIOME_TAGS.map((biome) => `<span class="biome-tag">${biome}</span>`).join("")}</div>
      <p class="biome-note">Biome vocabulary is ready for singleplayer. Province-level assignments await province boundaries.</p>
      <div class="sidebar-note"><strong>*Map-data note</strong><p>Countries use Natural Earth Admin 0 geometry (258 features); worldwide state/province polygons use Natural Earth 1:10m Admin 1. Both layers use real polygon geometry rather than oversized helper hitboxes.</p></div>
      <footer>WORLD AT WAR <span>·</span> EARLY DEVELOPMENT</footer>
    </aside>
    <section class="map-panel" aria-label="Interactive world map">
      <div class="map-toolbar"><div><span class="toolbar-kicker">STRATEGIC VIEW</span><strong>Global map</strong></div><div class="map-actions"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="reset-view">RESET VIEW</button></div></div>
      <div class="map-wrap" id="map-wrap"><div class="map-loading" id="map-loading">Rendering world geometry…</div><svg id="world-map" role="img" aria-label="Interactive map of world countries"></svg><div class="map-legend"><span><i class="legend-country"></i> Country</span><span><i class="legend-province"></i> State / province</span><span><i class="legend-selected"></i> Selected</span><span><i class="legend-ocean"></i> Ocean</span></div><div class="map-coordinates">WORLD MAP · PROVISIONAL GEOGRAPHY</div></div>
      <div class="map-footer"><span id="map-status">Loading country geometry…</span><span>SCENARIO DATA: 2026 <i>·</i> MAP DATA: PROVISIONAL</span></div>
    </section>
  </main>
  <dialog id="about-dialog"><div class="dialog-top"><h2>World at War</h2><button id="close-about" aria-label="Close">×</button></div><p>This is the first interactive map scaffold for a larger grand-strategy project.</p><p>The map is for development and does not yet represent authoritative 2026 borders, playable nations, or province-level territory ownership.</p></dialog>
`;

const mapWrap = document.querySelector<HTMLDivElement>("#map-wrap")!;
const svg = document.querySelector<SVGSVGElement>("#world-map")!;
const loading = document.querySelector<HTMLDivElement>("#map-loading")!;
const mapStatus = document.querySelector<HTMLSpanElement>("#map-status")!;
const selectedName = document.querySelector<HTMLHeadingElement>("#selected-name")!;
const selectedDetail = document.querySelector<HTMLParagraphElement>("#selected-detail")!;
const selectionCard = document.querySelector<HTMLElement>("#selection-card")!;

let selectedId: string | null = null;
let zoomScale = 1;
let panX = 0;
let panY = 0;
let mapContent: SVGGElement | null = null;
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
let administrativeFeatures: AdministrativeFeature[] = [];
let administrativeDataReady = false;
let administrativeCountryId: string | null = null;
let selectedProvinceId: string | null = null;

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
  // Use the actual container size: a forced 600px viewBox caused narrow layouts
  // to crop or scale the map awkwardly when the browser was resized.
  viewWidth = Math.max(1, Math.floor(bounds.width));
  viewHeight = Math.max(1, Math.floor(bounds.height));
  if (viewWidth <= 1 || viewHeight <= 1 || countryCollection.features.length === 0) return;

  svg.setAttribute("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
  svg.replaceChildren();

  // Keep the exact fitted projection. Reusing only its scale and replacing
  // its translation shifts manually projected geographic markers away from
  // the country geometry (notably the small-country hit targets and canals).
  const projection = geoNaturalEarth1()
    .fitExtent([[18, 24], [Math.max(19, viewWidth - 18), Math.max(25, viewHeight - 28)]], countryCollection);
  const path = geoPath(projection);
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const oceanPattern = document.createElementNS(defs.namespaceURI, "pattern");
  oceanPattern.setAttribute("id", "ocean-grid");
  oceanPattern.setAttribute("width", "36");
  oceanPattern.setAttribute("height", "36");
  oceanPattern.setAttribute("patternUnits", "userSpaceOnUse");
  const gridLine = document.createElementNS(defs.namespaceURI, "path");
  gridLine.setAttribute("d", "M 36 0 L 0 0 0 36");
  gridLine.setAttribute("fill", "none");
  gridLine.setAttribute("stroke", "#193344");
  gridLine.setAttribute("stroke-width", "0.6");
  oceanPattern.append(gridLine);
  defs.append(oceanPattern);
  svg.append(defs);

  const contentGroup = document.createElementNS(svg.namespaceURI, "g") as SVGGElement;
  mapContent = contentGroup;
  contentGroup.setAttribute("class", "map-content");
  const ocean = document.createElementNS(svg.namespaceURI, "rect");
  ocean.setAttribute("class", "ocean");
  ocean.setAttribute("width", String(viewWidth));
  ocean.setAttribute("height", String(viewHeight));
  ocean.setAttribute("fill", "url(#ocean-grid)");
  contentGroup.append(ocean);

  countryFeatures = countryCollection.features as CountryFeature[];
  const countryLayer = document.createElementNS(svg.namespaceURI, "g");
  countryLayer.setAttribute("class", "country-layer");
  contentGroup.append(countryLayer);
  // Attach the geometry before measuring paths so getBBox() returns real bounds.
  svg.append(contentGroup);

  // Each country's own rendered 1:10m polygon is also its hitbox.
  // No centroid circles or manually positioned targets: neighbouring countries
  // cannot be selected by an oversized helper target.
  for (const country of countryFeatures) {
    const countryId = String(country.id ?? country.properties.name ?? "unknown");
    const shape = document.createElementNS(svg.namespaceURI, "path") as SVGPathElement;
    shape.setAttribute("d", path(country) ?? "");
    shape.setAttribute("class", `country-shape${selectedId === countryId ? " selected" : ""}`);
    shape.setAttribute("data-country-id", countryId);
    shape.setAttribute("tabindex", "0");
    shape.setAttribute("role", "button");
    shape.setAttribute("aria-label", country.properties.name ?? `Country ${countryId}`);
    // Only the actual polygon fill receives pointer events, not its outline.
    shape.setAttribute("pointer-events", "visibleFill");
    shape.addEventListener("click", () => selectCountry(countryId));
    shape.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        selectCountry(countryId);
      }
    });
    countryLayer.append(shape);
  }

  // Always draw the complete global state/province layer, regardless of selection.
  // It is intentionally above country fills so the internal boundaries remain visible.
  if (allAdministrativeFeatures.length > 0) {
    const administrativeLayer = document.createElementNS(svg.namespaceURI, "g");
    administrativeLayer.setAttribute("class", "administrative-layer");
    for (const feature of allAdministrativeFeatures) {
      const provinceId = String(feature.id ?? feature.properties.shapeID ?? feature.properties.shapeName ?? "unknown");
      const shape = document.createElementNS(svg.namespaceURI, "path") as SVGPathElement;
      shape.setAttribute("d", path(feature) ?? "");
      shape.setAttribute("class", "admin-shape" + (selectedProvinceId === provinceId ? " selected" : ""));
      shape.setAttribute("data-province-id", provinceId);
      shape.setAttribute("tabindex", "0");
      shape.setAttribute("role", "button");
      shape.setAttribute("aria-label", String(feature.properties.shapeName ?? "State or province"));
      shape.setAttribute("pointer-events", "visibleFill");
      shape.addEventListener("click", (event) => {
        event.stopPropagation();
        selectProvince(provinceId);
      });
      shape.addEventListener("keydown", (event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          keyboardEvent.preventDefault();
          event.stopPropagation();
          selectProvince(provinceId);
        }
      });
      administrativeLayer.append(shape);
    }
    contentGroup.append(administrativeLayer);
  }

  applyViewTransform(false);
  loading.hidden = true;
  mapStatus.textContent = administrativeDataReady
    ? `${countryFeatures.length.toLocaleString()} countries · ${allAdministrativeFeatures.length.toLocaleString()} global state/province polygons visible`
    : `${countryFeatures.length.toLocaleString()} countries · loading global state/province polygons…`;
}

function zoomToCountry(id: string): void {
  const shape = svg.querySelector<SVGPathElement>(`.country-shape[data-country-id="${CSS.escape(id)}"]`);
  if (!shape) return;
  const bounds = shape.getBBox();
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width < 0.1 || bounds.height < 0.1) return;
  const padding = 44;
  const fitScale = Math.min((viewWidth - padding * 2) / Math.max(bounds.width, 1), (viewHeight - padding * 2) / Math.max(bounds.height, 1));
  zoomScale = Math.max(1, Math.min(18, fitScale));
  panX = viewWidth / 2 - (bounds.x + bounds.width / 2) * zoomScale;
  panY = viewHeight / 2 - (bounds.y + bounds.height / 2) * zoomScale;
  applyViewTransform();
}

function selectCountry(id: string): void {
  selectedId = id;
  selectedProvinceId = null;
  const country = countryFeatures.find((feature) => String(feature.id ?? feature.properties.name ?? "unknown") === id);
  if (!country) return;
  const name = country.properties.name ?? ("Country " + id);
  const iso3 = country.properties["ISO3166-1-Alpha-3"];
  administrativeFeatures = typeof iso3 === "string" && iso3 !== "-99"
    ? allAdministrativeFeatures.filter((feature) => feature.properties.parentCountryId === iso3)
    : [];
  administrativeCountryId = administrativeFeatures.length > 0 ? id : null;
  selectedName.textContent = name;
  selectionCard.classList.add("has-selection");
  for (const shape of svg.querySelectorAll<SVGPathElement>(".country-shape")) {
    shape.classList.toggle("selected", shape.dataset.countryId === id);
  }
  if (!administrativeDataReady) {
    selectedDetail.textContent = name + " · global state/province boundaries are still loading.";
    mapStatus.textContent = "Selected: " + name + " · loading global administrative geography…";
  } else if (administrativeFeatures.length > 0) {
    selectedDetail.textContent = name + " · " + administrativeFeatures.length.toLocaleString() + " first-level administrative areas in the global layer.";
    mapStatus.textContent = name + ": " + administrativeFeatures.length.toLocaleString() + " states/provinces · geoBoundaries (CC BY 4.0)";
  } else {
    selectedDetail.textContent = name + " · no first-level boundary data was available from the global source.";
    mapStatus.textContent = "Selected: " + name + " · no ADM1 data available";
  }
  renderMap();
  zoomToCountry(id);
}
function selectProvince(id: string): void {
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
  selectedId = parentCode ?? selectedId;
  selectedName.textContent = provinceName;
  selectedDetail.textContent = `${provinceName} · ${countryName}. State/province polygon selected. City polygons have not been added yet.`;
  selectionCard.classList.add("has-selection");
  for (const shape of svg.querySelectorAll<SVGPathElement>(".country-shape")) {
    shape.classList.toggle("selected", shape.dataset.countryId === selectedId);
  }
  for (const shape of svg.querySelectorAll<SVGPathElement>(".admin-shape")) {
    shape.classList.toggle("selected", shape.dataset.provinceId === id);
  }
  mapStatus.textContent = `Selected state/province: ${provinceName} · ${countryName}`;
}

function applyViewTransform(animate = true): void {
  if (!mapContent) return;
  mapContent.style.transition = animate ? "transform 180ms ease-out" : "none";
  mapContent.setAttribute("transform", "translate(" + panX + " " + panY + ") scale(" + zoomScale + ")");
}

function zoomAt(screenX: number, screenY: number, factor: number): void {
  const nextScale = Math.max(1, Math.min(40, zoomScale * factor));
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

document.querySelector("#zoom-in")?.addEventListener("click", () => zoomAtCenter(1.25));
document.querySelector("#zoom-out")?.addEventListener("click", () => zoomAtCenter(1 / 1.25));
document.querySelector("#reset-view")?.addEventListener("click", () => {
  zoomScale = 1;
  panX = 0;
  panY = 0;
  applyViewTransform();
});

svg.addEventListener("wheel", (event: WheelEvent) => {
  event.preventDefault();
  const bounds = svg.getBoundingClientRect();
  zoomAt(event.clientX - bounds.left, event.clientY - bounds.top, event.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

svg.addEventListener("pointerdown", (event: PointerEvent) => {
  if (event.button !== 0) return;
  suppressNextClick = false;
  isPanning = true;
  didPan = false;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  panStartX = panX;
  panStartY = panY;
  if (mapContent) mapContent.style.transition = "none";
});

window.addEventListener("pointermove", (event: PointerEvent) => {
  if (!isPanning) return;
  const dx = event.clientX - pointerStartX;
  const dy = event.clientY - pointerStartY;
  if (Math.abs(dx) + Math.abs(dy) > 4) didPan = true;
  if (!didPan) return;
  panX = panStartX + dx;
  panY = panStartY + dy;
  applyViewTransform(false);
});

function finishPan(): void {
  if (!isPanning) return;
  isPanning = false;
  if (didPan) suppressNextClick = true;
}

window.addEventListener("pointerup", finishPan);
window.addEventListener("pointercancel", finishPan);
svg.addEventListener("click", (event: MouseEvent) => {
  if (!suppressNextClick) return;
  suppressNextClick = false;
  event.preventDefault();
  event.stopPropagation();
}, true);
document.querySelector("#about-button")?.addEventListener("click", () => (document.querySelector<HTMLDialogElement>("#about-dialog")!).showModal());
document.querySelector("#close-about")?.addEventListener("click", () => document.querySelector<HTMLDialogElement>("#about-dialog")!.close());

let resizeFrame = 0;
const resizeObserver = new ResizeObserver(() => {
  // Coalesce rapid resize events so a drag doesn't rebuild the SVG hundreds
  // of times per second on slower devices.
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    renderMap();
  });
});
resizeObserver.observe(mapWrap);
loadCountryGeometry();
void loadAllFirstLevelBoundaries()
  .then((features) => {
    allAdministrativeFeatures = features;
    administrativeDataReady = true;
    if (selectedId) {
      const country = countryFeatures.find((feature) => String(feature.id ?? feature.properties.name ?? "unknown") === selectedId);
      const iso3 = country?.properties["ISO3166-1-Alpha-3"];
      administrativeFeatures = typeof iso3 === "string" && iso3 !== "-99"
        ? allAdministrativeFeatures.filter((feature) => feature.properties.parentCountryId === iso3)
        : [];
      administrativeCountryId = administrativeFeatures.length > 0 ? selectedId : null;
      if (country) {
        const name = country.properties.name ?? ("Country " + selectedId);
        selectedDetail.textContent = administrativeFeatures.length
          ? name + " · " + administrativeFeatures.length.toLocaleString() + " first-level administrative areas loaded. Select a state or province on the map."
          : name + " · no first-level boundary data was available from the global source.";
      }
    }
    renderMap();
    mapStatus.textContent = "Global state/province layer visible · " + allAdministrativeFeatures.length.toLocaleString() + " polygons";
  })
  .catch((error) => {
    console.error("World at War global administrative geography failed to load:", error);
    administrativeDataReady = false;
    mapStatus.textContent = "Global state/province data failed to load. Check the connection and refresh.";
    if (selectedId) selectedDetail.textContent = "Global state/province boundaries failed to load. Check the connection and refresh.";
  });
