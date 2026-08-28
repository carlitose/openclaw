import type { BrowserTabSnapshot } from "./tab-eligibility.js";

export type TaskCleanupResult = {
  status: "complete" | "incomplete";
  remainingTabIds: number[];
  errors: Array<{ tabId: number; message: string }>;
};

export type TaskTabLifecycle = {
  registerRoot(tabId: number): string;
  registerDescendant(openerTabId: number, tabId: number): string | null;
  generationFor(tabId: number): string | undefined;
  owns(tabId: number, generation: unknown): boolean;
  replace(addedTabId: number, removedTabId: number): boolean;
  forget(tabId: number): void;
  revoke(tabId: number): void;
  revokeAll(): void;
  cleanup(generation: string): Promise<TaskCleanupResult>;
  cleanupAll(): Promise<TaskCleanupResult[]>;
};

export function createTaskTabLifecycle(options?: {
  chromeApi?: {
    tabs: {
      remove(tabId: number): void | Promise<void>;
      get(tabId: number): BrowserTabSnapshot | null | Promise<BrowserTabSnapshot | null>;
    };
  };
  newGeneration?: () => string;
}): TaskTabLifecycle;
