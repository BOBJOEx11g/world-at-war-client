# World at War — Client

The browser client for **World at War**, a persistent, full-world grand-strategy game.

The current sate can be found here: https://bobjoex11g.github.io/world-at-war-client/

## Current status

The initial client scaffold includes:

- TypeScript + Vite.
- Interactive SVG country map using Natural Earth 1:50m country geometry.
- Country selection and map zoom controls.
- Lazy-loaded state/province boundaries (ADM1) for the selected country, with selectable administrative areas.
- Shared biome and terrain tag vocabulary for future singleplayer and multiplayer province data.
- A responsive strategy-game interface.
- A GitHub Actions workflow for GitHub Pages deployment.

**Important:** this is a technical map prototype, not the finished game map. The source geometry is not province-level and may simplify or omit tiny islands. The full map pipeline must audit and supplement geography before the map can be considered complete.

## Administrative boundaries

First-level state/province boundaries are loaded on demand from [geoBoundaries](https://www.geoboundaries.org/) gbOpen data when a country is selected. The client uses the source-provided simplified GeoJSON when available, caches loaded country boundaries for the current session, and displays an attribution notice in the map status. geoBoundaries gbOpen data is licensed CC BY 4.0; see the [source licence and attribution guidance](https://www.geoboundaries.org/).

Only the selected country’s ADM1 boundaries are loaded to avoid downloading a huge global boundary file at startup. Administrative units can be selected, but province ownership, biome assignments, and lower administrative levels are not implemented yet.

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
