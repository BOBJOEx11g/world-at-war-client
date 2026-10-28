# World at War — Client

The browser client for **World at War**, a persistent, full-world grand-strategy game.

Live client: https://bobjoex11g.github.io/world-at-war-client/

## Current client status

The client is a TypeScript + Vite application deployed to GitHub Pages. The map rendering architecture has been migrated from SVG geometry to WebGL:

- Country fills and international borders render through GPU buffers.
- State/province boundaries, lake polygons, urban-area polygons, biome overlays, and selection highlights render through WebGL.
- The map no longer creates an SVG path element for each province or city. A lightweight HTML input layer handles pan, zoom, and territory picking.
- Boundary segments are batched into GPU buffers; screen-space border meshes keep international borders thicker than province borders without relying on unsupported WebGL line-width settings.
- Country, lake, and province geometry have coarse and detailed levels of detail. Small polygon features are protected from simplification.
- Territory picking uses a geographic spatial index rather than scanning every polygon for each click.
- Urban-area metadata and its spatial index are prepared in a background Web Worker. Urban polygon triangulation is deferred until the player zooms in.
- Static GPU geometry is reused when the map is redrawn at the same dimensions and source data has not changed. Pan/zoom redraws are coalesced to animation frames.
- The ocean texture and the existing interface layout are retained.

**Verification note:** source changes are committed, but a successful production build, successful Pages deployment, and visual/performance testing on the live client must still be confirmed before this migration can be considered fully verified.

## Performance roadmap

### Current implementation
1. WebGL-based map rendering with GPU buffers.
2. Batched boundary drawing and screen-space border widths.
3. Coarse/detailed geometry levels of detail.
4. Spatial indexing for province and urban-area picking.
5. Background processing for urban metadata and indexing.
6. Lazy urban geometry preparation and animation-frame redraw scheduling.
7. Reuse of unchanged projected geometry buffers.

### Next optimization stages
1. **Build and runtime verification:** run `npm run build`, confirm GitHub Actions deployment, and test map loading, selection, pan/zoom, resize, lakes, biomes, and city visibility.
2. **Measure performance:** record startup time, frame time during pan/zoom, memory use, and click responsiveness on desktop and lower-powered devices.
3. **Viewport culling and spatial render tiles:** avoid submitting off-screen detailed geometry while preserving the complete source map and small islands.
4. **Move remaining expensive geometry preparation off the main thread:** especially administrative-boundary indexing and polygon triangulation.
5. **Improve data caching and loading:** reuse processed data where practical, handle source failures cleanly, and avoid unnecessary full-data downloads or rebuilds.
6. **Geographic completeness:** audit tiny islands, lake coverage, missing urban areas, and city-to-province containment. Urban footprints are built-up areas, not official municipal boundaries.
7. **Unify the game territory model:** separate static geometry from changing territory state and give each game territory a stable ID, parent, terrain, ownership, connections, and gameplay properties.

Performance work must not achieve speed by deleting required map detail. Keep all countries playable, preserve small islands, keep province/state borders visible globally, and show city polygons above province boundaries at appropriate zoom levels.

## Gameplay roadmap

The map is the foundation, not the finished game. The intended sequence is:

1. Complete and verify the map rendering/performance foundation.
2. Build the unified territory database for rural and urban territories; capitals are a separate flag rather than a third mutually exclusive territory type.
3. Add territory ownership, population, buildings, resources, and context-sensitive territory information/construction UI.
4. Add connected territory/sea paths for unit movement and route finding.
5. Implement the economy: money, food, oil, metal, manpower, and earnable gold.
6. Add research and production timers; gold can speed them up but is earned through play rather than purchased with real money.
7. Implement authoritative server state, saving, multiplayer synchronization, AI-controlled unclaimed nations, and the ability for AI to control a player's nation while that player is offline.
8. Ship the modern-world 2026 scenario first. A 1942 scenario comes later and should reuse the engine with separate historical borders, ownership, and scenario data.

## Map data and limitations

- Countries use Natural Earth Admin 0 geometry.
- State/province polygons use Natural Earth 1:10m Admin 1.
- Lakes and urban areas use Natural Earth 1:10m datasets.
- The optional biome overlay uses RESOLVE Ecoregions 2017, CC BY 4.0.
- These sources are cartographic datasets, not a guarantee of every small jurisdiction, settlement, or recent border change.

See [docs/map-data.md](docs/map-data.md) for the data pipeline and limitations.

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the deployment source if needed. The workflow builds and deploys the client on pushes to `main`.
