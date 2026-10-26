# World at War — Client

The browser client for **World at War**, a persistent, full-world grand-strategy game.

## Current status

The initial client scaffold includes:

- TypeScript + Vite.
- Interactive SVG country map using Natural Earth 1:50m country geometry.
- Country selection and map zoom controls.
- A responsive strategy-game interface.
- A GitHub Actions workflow for GitHub Pages deployment.

**Important:** this is a technical map prototype, not the finished game map. The source geometry is not province-level and may simplify or omit tiny islands. The full map pipeline must audit and supplement geography before the map can be considered complete.

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
