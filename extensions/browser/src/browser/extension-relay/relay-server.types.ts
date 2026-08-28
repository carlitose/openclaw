import type { CompiledNavigationPolicyV1 } from "../../../chrome-extension/modules/navigation-policy.js";
import type { LookupFn, SsrFPolicy } from "../../infra/net/ssrf.js";

export type StartExtensionRelayServerParams = {
  port: number;
  token: string;
  allowLegacyAuth?: boolean;
  onStateChange?: () => void;
  navigationPolicy?: CompiledNavigationPolicyV1;
  ssrfPolicy?: SsrFPolicy;
  lookupFn?: LookupFn;
};
