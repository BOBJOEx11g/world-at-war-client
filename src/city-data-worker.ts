type PlaceProperties = {
  name?: string; NAME?: string; nameascii?: string;
  adm0name?: string; ADM0NAME?: string; admin?: string; ADMIN?: string;
  ADM0CAP?: number | string; SCALERANK?: number | string; scalerank?: number | string;
  [key: string]: unknown;
};
type PlaceFeature = GeoJSON.Feature<GeoJSON.Point, PlaceProperties>;
type Request = { placesUrl: string };
type CityRecord = {
  id: string; name: string; country: string; longitude: number; latitude: number;
  isCapital: boolean; scaleRank: number;
};
type Result = { type: "success"; records: CityRecord[] };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const response = await fetch(event.data.placesUrl, {
      headers: { accept: "application/geo+json, application/json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Populated-place request failed: HTTP ${response.status}`);
    const dataset = await response.json() as { type?: string; features?: PlaceFeature[] };
    if (dataset.type !== "FeatureCollection" || !Array.isArray(dataset.features) || !dataset.features.length) {
      throw new Error("Populated-place source did not return a valid GeoJSON FeatureCollection.");
    }
    const records: CityRecord[] = [];
    for (const [index, place] of dataset.features.entries()) {
      if (place.geometry?.type !== "Point") continue;
      const props = place.properties ?? {};
      const rankValue = Number(props.SCALERANK ?? props.scalerank ?? 10);
      const scaleRank = Number.isFinite(rankValue) ? rankValue : 10;
      const isCapital = Number(props.ADM0CAP) === 1;
      // Natural Earth ranks 0-4 are its major populated places. Capitals are
      // always included even if their scale rank is lower priority.
      if (!isCapital && scaleRank > 4) continue;
      const [longitude, latitude] = place.geometry.coordinates;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
      const name = String(props.name ?? props.NAME ?? props.nameascii ?? "").trim();
      if (!name) continue;
      const country = String(props.adm0name ?? props.ADM0NAME ?? props.admin ?? props.ADMIN ?? "Country unavailable");
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      records.push({ id: `major-city-${index}-${slug}`, name, country, longitude, latitude, isCapital, scaleRank });
    }
    scope.postMessage({ type: "success", records } satisfies Result);
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
