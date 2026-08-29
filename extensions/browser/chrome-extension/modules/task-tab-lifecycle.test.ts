import { describe, expect, it, vi } from "vitest";
import { createTaskTabLifecycle } from "./task-tab-lifecycle.js";

describe("task tab lifecycle", () => {
  it("closes descendants before the exact root and verifies absence", async () => {
    const present = new Set([10, 11, 12]);
    const remove = vi.fn(async (tabId: number) => {
      present.delete(tabId);
    });
    const lifecycle = createTaskTabLifecycle({
      chromeApi: { tabs: { remove, get: async (id: number) => (present.has(id) ? { id } : null) } },
      newGeneration: () => "generation-1",
    });
    const generation = lifecycle.registerRoot(10);
    lifecycle.registerDescendant(10, 11);
    lifecycle.registerDescendant(11, 12);

    await expect(lifecycle.cleanup(generation)).resolves.toEqual({
      status: "complete",
      remainingTabIds: [],
      errors: [],
    });
    expect(remove.mock.calls.map(([tabId]) => tabId)).toEqual([12, 11, 10]);
  });

  it("preserves a generation across renderer replacement and revokes it explicitly", () => {
    const lifecycle = createTaskTabLifecycle({
      chromeApi: { tabs: { remove: vi.fn(), get: vi.fn() } },
      newGeneration: () => "generation-1",
    });
    lifecycle.registerRoot(10);
    expect(lifecycle.replace(20, 10)).toBe(true);
    expect(lifecycle.owns(20, "generation-1")).toBe(true);
    lifecycle.revoke(20);
    expect(lifecycle.generationFor(20)).toBeUndefined();
  });

  it("retains the root and generation until every descendant is absent", async () => {
    const present = new Set([10, 11]);
    let descendantRemovalFails = true;
    const remove = vi.fn(async (tabId: number) => {
      if (tabId === 11 && descendantRemovalFails) {
        throw new Error("child removal denied");
      }
      present.delete(tabId);
    });
    const lifecycle = createTaskTabLifecycle({
      chromeApi: { tabs: { remove, get: async (id: number) => (present.has(id) ? { id } : null) } },
      newGeneration: () => "generation-1",
    });
    const generation = lifecycle.registerRoot(10);
    lifecycle.registerDescendant(10, 11);

    await expect(lifecycle.cleanup(generation)).resolves.toEqual({
      status: "incomplete",
      remainingTabIds: [11, 10],
      errors: [{ tabId: 11, message: "child removal denied" }],
    });
    expect(remove).not.toHaveBeenCalledWith(10);
    expect(lifecycle.owns(11, generation)).toBe(true);

    descendantRemovalFails = false;
    await expect(lifecycle.cleanup(generation)).resolves.toEqual({
      status: "complete",
      remainingTabIds: [],
      errors: [],
    });
    expect(remove.mock.calls.map(([tabId]) => tabId)).toEqual([11, 11, 10]);
  });
});
