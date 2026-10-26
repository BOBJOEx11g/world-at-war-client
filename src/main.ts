import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldAtlas from "world-atlas/countries-50m.json";
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
      <div class="sidebar-note"><strong>*Map-data note</strong><p>This first renderer uses Natural Earth 1:50m country geometry to prove the pipeline. It is not yet the final province-level map, and some tiny islands may be simplified or omitted. We'll replace and augment it with audited, higher-detail data.</p></div>
      <footer>WORLD AT WAR <span>·</span> EARLY DEVELOPMENT</footer>
    </aside>
    <section class="map-panel" aria-label="Interactive world map">
      <div class="map-toolbar"><div><span class="toolbar-kicker">STRATEGIC VIEW</span><strong>Global map</strong></div><div class="map-actions"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="reset-view">RESET VIEW</button></div></div>
      <div class="map-wrap" id="map-wrap"><div class="map-loading" id="map-loading">Rendering world geometry…</div><svg id="world-map" role="img" aria-label="Interactive map of world countries"></svg><div class="map-legend"><span><i class="legend-country"></i> Country</span><span><i class="legend-selected"></i> Selected</span><span><i class="legend-ocean"></i> Ocean</span></div><div class="map-coordinates">WORLD MAP · PROVISIONAL GEOGRAPHY</div></div>
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
let zoom = 1;
let viewWidth = 1200;
let viewHeight = 650;
let countryFeatures: CountryFeature[] = [];

const topology = worldAtlas as unknown as Topology;
const countriesObject = topology.objects["countries"] as GeometryCollection<CountryProperties>;
const countryCollection = feature(topology, countriesObject) as GeoJSON.FeatureCollection<GeoJSON.Geometry, CountryProperties>;

function renderMap(): void {
  const bounds = mapWrap.getBoundingClientRect();
  viewWidth = Math.max(600, Math.floor(bounds.width));
  viewHeight = Math.max(360, Math.floor(bounds.height));
  svg.setAttribute("viewBox", `0 0 ${viewWidth} ${viewHeight}`);
  svg.replaceChildren();

  const projection = geoNaturalEarth1()
    .fitExtent([[18, 24], [viewWidth - 18, viewHeight - 28]], countryCollection)
    .scale((geoNaturalEarth1().fitExtent([[18, 24], [viewWidth - 18, viewHeight - 28]], countryCollection).scale()) * zoom)
    .translate([
      viewWidth / 2 + (viewWidth / 2 - 0) * (1 - zoom),
      viewHeight / 2 + (viewHeight / 2 - 0) * (1 - zoom)
    ]);
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

  const ocean = document.createElementNS(svg.namespaceURI, "rect");
  ocean.setAttribute("class", "ocean");
  ocean.setAttribute("width", String(viewWidth));
  ocean.setAttribute("height", String(viewHeight));
  ocean.setAttribute("fill", "url(#ocean-grid)");
  svg.append(ocean);

  countryFeatures = countryCollection.features as CountryFeature[];
  const countryLayer = document.createElementNS(svg.namespaceURI, "g");
  countryLayer.setAttribute("class", "country-layer");

  for (const country of countryFeatures) {
    const countryId = String(country.id ?? country.properties.name ?? "unknown");
    const shape = document.createElementNS(svg.namespaceURI, "path");
    shape.setAttribute("d", path(country) ?? "");
    shape.setAttribute("class", `country-shape${selectedId === countryId ? " selected" : ""}`);
    shape.setAttribute("data-country-id", countryId);
    shape.setAttribute("tabindex", "0");
    shape.setAttribute("role", "button");
    shape.setAttribute("aria-label", country.properties.name ?? `Country ${countryId}`);
    shape.addEventListener("click", () => selectCountry(countryId));
    shape.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCountry(countryId);
      }
    });
    countryLayer.append(shape);
  }
  svg.append(countryLayer);
  loading.hidden = true;
  mapStatus.textContent = `${countryFeatures.length.toLocaleString()} country features loaded · click a territory`;
}

function selectCountry(id: string): void {
  selectedId = id;
  const country = countryFeatures.find((feature) => String(feature.id ?? feature.properties.name ?? "unknown") === id);
  if (!country) return;
  const name = country.properties.name ?? `Country ${id}`;
  selectedName.textContent = name;
  selectedDetail.textContent = `Map feature ID: ${id}. Historical status and playable-nation data are not yet attached.`;
  selectionCard.classList.add("has-selection");
  for (const shape of svg.querySelectorAll<SVGPathElement>(".country-shape")) {
    shape.classList.toggle("selected", shape.dataset.countryId === id);
  }
  mapStatus.textContent = `Selected: ${name}`;
}

document.querySelector("#zoom-in")?.addEventListener("click", () => { zoom = Math.min(zoom * 1.25, 8); renderMap(); });
document.querySelector("#zoom-out")?.addEventListener("click", () => { zoom = Math.max(zoom / 1.25, 1); renderMap(); });
document.querySelector("#reset-view")?.addEventListener("click", () => { zoom = 1; renderMap(); });
document.querySelector("#about-button")?.addEventListener("click", () => (document.querySelector<HTMLDialogElement>("#about-dialog")!).showModal());
document.querySelector("#close-about")?.addEventListener("click", () => document.querySelector<HTMLDialogElement>("#about-dialog")!.close());

const resizeObserver = new ResizeObserver(() => renderMap());
resizeObserver.observe(mapWrap);
renderMap();
