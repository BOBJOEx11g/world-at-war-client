# World at War — Client

The browser client for **World at War**, a persistent, full-world grand-strategy game.

The current sate can be found here: https://bobjoex11g.github.io/world-at-war-client/

## Current status

The initial client scaffold includes:

- TypeScript + Vite.
- Interactive SVG country map using Natural Earth 1:50m country geometry.
- Country selection and map zoom controls.
- Worldwide first-level state/province polygons, drawn by default without selecting a country.
- Shared biome and terrain tag vocabulary for future singleplayer and multiplayer province data.
- A responsive strategy-game interface.
- A GitHub Actions workflow for GitHub Pages deployment.

**Important:** this is a technical map prototype, not the finished game map. The source geometry is not province-level and may simplify or omit tiny islands. The full map pipeline must audit and supplement geography before the map can be considered complete.

## Administrative boundaries

The client fetches a single global GeoJSON file of first-level state/province polygons from Natural Earth's 1:10m Admin 1 States/Provinces dataset. All loaded polygons are rendered by default; selecting a country is not required to see them. Each polygon receives a stable ID and a parent-country code when the source provides one.

Source: [Natural Earth 1:10m Admin 1 – States, Provinces](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/). Natural Earth geography is public domain. The dataset is a cartographic generalization and does not contain every small jurisdiction or reflect every recent border change.

**Not implemented yet:** persistent server-side province records, city/municipality polygons and automatic parent assignment between city areas and provinces. Administrative levels differ by country, and ADM2 often means a county or district rather than a city, so city polygons need a separate source and parent-containment validation instead of relabelling every ADM2 polygon as a city.

## Run locally

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm run dev
```

Vite prints the local URL in the terminal.

## Build

```bash
npm run build
```

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. In GitHub, open **Settings → Pages** and select **GitHub Actions** as the deployment source if it is not already selected. The workflow then builds and deploys the client on pushes to `main`.

## Map data

See [docs/map-data.md](docs/map-data.md) for the current data source, its limitations, and the plan for a detailed, auditable world-map pipeline.

## Scenario plan

The first scenario is the modern world in 2026. A future 1942 scenario should reuse the engine and client while loading its own historical borders, ownership, and scenario data.
