/** Own exact physical tab provenance independently from the published inventory. */
export function createTaskTabLifecycle({
  chromeApi = chrome,
  newGeneration = () => crypto.randomUUID(),
} = {}) {
  const roots = new Map();
  const nodes = new Map();

  function registerRoot(tabId) {
    const generation = newGeneration();
    const task = { generation, rootTabId: tabId };
    roots.set(generation, task);
    nodes.set(tabId, { generation, parentTabId: null });
    return generation;
  }

  function registerDescendant(openerTabId, tabId) {
    const opener = nodes.get(openerTabId);
    if (!opener || nodes.has(tabId)) {
      return null;
    }
    nodes.set(tabId, { generation: opener.generation, parentTabId: openerTabId });
    return opener.generation;
  }

  function generationFor(tabId) {
    return nodes.get(tabId)?.generation;
  }

  function owns(tabId, generation) {
    return typeof generation === "string" && generationFor(tabId) === generation;
  }

  function replace(addedTabId, removedTabId) {
    const node = nodes.get(removedTabId);
    if (!node) {
      return false;
    }
    nodes.delete(removedTabId);
    nodes.set(addedTabId, node);
    const root = roots.get(node.generation);
    if (root?.rootTabId === removedTabId) {
      root.rootTabId = addedTabId;
    }
    for (const child of nodes.values()) {
      if (child.parentTabId === removedTabId) {
        child.parentTabId = addedTabId;
      }
    }
    return true;
  }

  function forget(tabId) {
    const node = nodes.get(tabId);
    if (!node) {
      return;
    }
    nodes.delete(tabId);
    const root = roots.get(node.generation);
    if (root?.rootTabId === tabId) {
      roots.delete(node.generation);
      for (const [ownedTabId, owned] of nodes) {
        if (owned.generation === node.generation) {
          nodes.delete(ownedTabId);
        }
      }
    }
  }

  function revoke(tabId) {
    const generation = generationFor(tabId);
    if (!generation) {
      return;
    }
    roots.delete(generation);
    for (const [ownedTabId, owned] of nodes) {
      if (owned.generation === generation) {
        nodes.delete(ownedTabId);
      }
    }
  }

  function revokeAll() {
    roots.clear();
    nodes.clear();
  }

  function orderedTabIds(generation) {
    const task = roots.get(generation);
    if (!task) {
      return [];
    }
    const depth = (tabId) => {
      let value = 0;
      let current = nodes.get(tabId);
      while (current?.parentTabId !== null && current?.parentTabId !== undefined) {
        value += 1;
        current = nodes.get(current.parentTabId);
      }
      return value;
    };
    return [...nodes]
      .filter(([, node]) => node.generation === generation)
      .map(([tabId]) => tabId)
      .toSorted((left, right) => depth(right) - depth(left) || left - right);
  }

  async function cleanup(generation) {
    const task = roots.get(generation);
    if (!task) {
      return { status: "complete", remainingTabIds: [], errors: [] };
    }
    const tabIds = orderedTabIds(generation);
    const errors = [];
    const descendants = tabIds.filter((tabId) => tabId !== task.rootTabId);
    for (const tabId of descendants) {
      try {
        await chromeApi.tabs.remove(tabId);
      } catch (error) {
        errors.push({ tabId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const remainingTabIds = [];
    for (const tabId of descendants) {
      if (await chromeApi.tabs.get(tabId).catch(() => null)) {
        remainingTabIds.push(tabId);
      } else {
        nodes.delete(tabId);
      }
    }
    if (remainingTabIds.length === 0) {
      try {
        await chromeApi.tabs.remove(task.rootTabId);
      } catch (error) {
        errors.push({
          tabId: task.rootTabId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (await chromeApi.tabs.get(task.rootTabId).catch(() => null)) {
      remainingTabIds.push(task.rootTabId);
    } else {
      nodes.delete(task.rootTabId);
    }
    if (remainingTabIds.length === 0) {
      roots.delete(generation);
    }
    return {
      status: remainingTabIds.length === 0 ? "complete" : "incomplete",
      remainingTabIds,
      errors,
    };
  }

  async function cleanupAll() {
    return await Promise.all([...roots.keys()].map((generation) => cleanup(generation)));
  }

  return {
    registerRoot,
    registerDescendant,
    generationFor,
    owns,
    replace,
    forget,
    revoke,
    revokeAll,
    cleanup,
    cleanupAll,
  };
}
