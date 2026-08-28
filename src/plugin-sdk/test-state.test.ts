import { describe, expect, it } from "vitest";
import {
  createOpenClawTestState as createOpenClawTestStateDirect,
  withOpenClawTestState as withOpenClawTestStateDirect,
} from "../test-utils/openclaw-test-state.js";
import { getDeterministicFreePortBlock as getDeterministicFreePortBlockDirect } from "../test-utils/ports.js";
import {
  createOpenClawTestState,
  getDeterministicFreePortBlock,
  withOpenClawTestState,
} from "./test-state.js";

describe("test-state SDK seam", () => {
  it("re-exports the canonical isolated state lifecycle", () => {
    expect(createOpenClawTestState).toBe(createOpenClawTestStateDirect);
    expect(withOpenClawTestState).toBe(withOpenClawTestStateDirect);
    expect(getDeterministicFreePortBlock).toBe(getDeterministicFreePortBlockDirect);
  });
});
