import { afterEach, describe, expect, it, vi } from "vitest";
import { createTabInventorySync } from "./tab-inventory-sync.js";

afterEach(() => vi.useRealTimers());

describe("tab inventory sync", () => {
  it("debounces scheduled projections", async () => {
    vi.useFakeTimers();
    const sync = vi.fn(async (): Promise<void> => undefined);
    const inventory = createTabInventorySync({ debounceMs: 25, sync });

    inventory.schedule();
    inventory.schedule();
    await vi.advanceTimersByTimeAsync(25);

    expect(sync).toHaveBeenCalledOnce();
  });

  it("retries an invalidated read before a flush resolves", async () => {
    vi.useFakeTimers();
    let finishFirstRead: (() => void) | undefined;
    const published: number[] = [];
    const sync = vi.fn(async (isCurrent: () => boolean) => {
      const read = sync.mock.calls.length;
      if (read === 1) {
        await new Promise<void>((resolve) => {
          finishFirstRead = resolve;
        });
      }
      if (isCurrent()) {
        published.push(read);
      }
    });
    const inventory = createTabInventorySync({ debounceMs: 25, sync });

    inventory.schedule();
    await vi.advanceTimersByTimeAsync(25);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce());
    const flushing = inventory.flush();
    finishFirstRead?.();
    await flushing;

    expect(sync).toHaveBeenCalledTimes(2);
    expect(published).toEqual([2]);
  });
});
