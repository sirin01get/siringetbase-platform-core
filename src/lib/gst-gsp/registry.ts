import { env } from "@/config/env";
import type { GstGatewayPort } from "./types";
import { genericGspMock } from "./gateways/generic-gsp-mock";

const GST_GATEWAYS: Record<string, GstGatewayPort> = {
  "generic-gsp-mock": genericGspMock,
};

// The ONLY place calling code should ever look up which GSP adapter is
// active. service.ts and every future caller depend on GstGatewayPort,
// never on a provider name — that's what makes swapping a mock for a real
// GSP adapter later a one-line env change here, not a rewrite anywhere
// else (../../gst-gsp/README.md's "Mock-to-Real" contract).
export function getGstGateway(): GstGatewayPort {
  const provider = env.gstGatewayProvider();
  const gateway = GST_GATEWAYS[provider];
  if (!gateway) throw new Error(`Unknown GST_GATEWAY_PROVIDER: ${provider}`);
  return gateway;
}
