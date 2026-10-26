# World at War — Client

The browser client for **World at War**, a persistent, full-world grand-strategy game.

The current sate can be found here: https://bobjoex11g.github.io/world-at-war-client/

## Current status

The initial client scaffold includes:

- TypeScript + Vite.
- Interactive SVG country map using Natural Earth 1:50m country geometry.
- Country selection and map zoom controls.
- A world-wide index of first-level state/province boundaries (ADM1), loaded independently of country selection, with selectable administrative areas for the selected country.
- Shared biome and terrain tag vocabulary for future singleplayer and multiplayer province data.
- A responsive strategy-game interface.
- A GitHub Actions workflow for GitHub Pages deployment.

**Important:** this is a technical map prototype, not the finished game map. The source geometry is not province-level and may simplify or omit tiny islands. The full map pipeline must audit and supplement geography before the map can be considered complete.

## Administrative boundaries

The client loads the global index of available first-level state/province boundaries (ADM1) from [geoBoundaries](https://www.geoboundaries.org/) gbOpen metadata, then fetches the simplified geometry files with limited concurrency. The data is retained in memory independently of which country is selected; selecting a country filters the already-loaded global region set for display. Every region receives a stable source-based ID and a parent country ISO-3 link. A failed country geometry request is skipped without preventing the rest of the world from loading.

geoBoundaries gbOpen data is licensed CC BY 4.0; see the [source licence and attribution guidance](https://www.geoboundaries.org/). The map displays source attribution.

**Not implemented yet:** persistent server-side province records, city/municipality boundaries, and automatic parent assignment between lower-level areas and provinces. Administrative levels differ by country, and ADM2 often means a county or district rather than a city, so city boundaries must be sourced and classified carefully instead of relabelling every ADM2 polygon as a city.

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
