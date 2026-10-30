import { buildStrategicGraph, type GraphCity } from "./world-graph";
import type { AdministrativeFeature } from "./admin-boundaries";

type Request = { provinces: AdministrativeFeature[]; cities: GraphCity[] };

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    const graph = buildStrategicGraph(event.data.provinces, event.data.cities);
    self.postMessage({ type: "success", graph });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
