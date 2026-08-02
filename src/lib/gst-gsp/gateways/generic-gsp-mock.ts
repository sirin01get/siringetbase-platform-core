import { createMockGstGateway } from "../mock-helpers";

// Stand-in for a real GSP integration — deliberately generic (not named
// after any one GSP) since no GSP has been selected yet
// (../../../../gst-gsp/README.md's "GST Rail" table). Swapping this for a
// real adapter later means: pick a GSP (Masters India, Cygnet, IRIS
// Business, Vayana, etc.), implement GstGatewayPort against that GSP's
// actual REST+OAuth2 API, pass the same contract tests this mock passes,
// flip GST_GATEWAY_PROVIDER — no change to registry.ts's callers.
export const genericGspMock = createMockGstGateway("generic-gsp-mock");
