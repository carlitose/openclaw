export function createTabInventorySync({ debounceMs, sync }) {
  let timer = null;
  let revision = 0;
  let inFlight = null;

  const drain = () => {
    if (inFlight) {
      return inFlight;
    }
    const pending = (async () => {
      for (;;) {
        const currentRevision = revision;
        await sync(() => currentRevision === revision);
        if (currentRevision === revision) {
          return;
        }
      }
    })();
    inFlight = pending;
    const clearPending = () => {
      if (inFlight === pending) {
        inFlight = null;
      }
    };
    void pending.then(clearPending, clearPending);
    return pending;
  };

  return {
    schedule() {
      revision += 1;
      if (timer || inFlight) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, debounceMs);
    },
    async flush() {
      revision += 1;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await drain();
    },
  };
}
