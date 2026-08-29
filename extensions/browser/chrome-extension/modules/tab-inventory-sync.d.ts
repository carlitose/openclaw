export function createTabInventorySync(params: {
  debounceMs: number;
  sync: (isCurrent: () => boolean) => Promise<void>;
}): {
  schedule(): void;
  flush(): Promise<void>;
};
