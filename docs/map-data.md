# Map data pipeline

## Current renderer

The first interactive renderer uses the `world-atlas` package's Natural Earth 1:50m country topology. It is a provisional country-outline layer used to validate the client, rendering, selection, and build pipeline.

It is **not** the final game map. It is not province-level, does not define all playable political entities, and its source resolution may simplify or omit small islands.

## Target data model

Keep geographic shapes and scenario state separate.

- `featureId`: stable ID for a geometry feature.
- `entityType`: sovereign state, dependent territory, disputed area, or uninhabited territory.
- `scenarioId`: scenario that supplies the political state.
- `ownerNationId`: scenario-specific owner, where applicable.
- `sourceDataset`, `sourceVersion`, `license`: provenance.
- `geometry`: polygon or multipolygon in a documented coordinate reference system.
- `provinceId`: stable game province ID after province segmentation.

## Planned pipeline

1. Select source datasets whose licences permit the intended use and redistribution.
2. Audit source coverage, especially remote islands, overseas territories, microstates, and disputed areas.
3. Import country and territory geometries, repair invalid polygons, and preserve small features.
4. Create gameplay provinces at the chosen granularity; ordinary national borders are not enough.
5. Generate a versioned, simplified client export plus detailed authoritative server data.
6. Run automated checks for missing IDs, invalid geometry, unexpected gaps, overlaps, and unassigned features.

## Design warning

Never use country polygon area as a filter for whether a territory is important. Small geometry is still valid game content. Use multi-scale rendering and insets where necessary to keep tiny islands visible and selectable.
