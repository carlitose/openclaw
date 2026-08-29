import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupBackgroundHarnesses,
  loadBackground,
  sendRuntimeMessage,
  TEST_RELAY_KEY,
} from "./background.test-harness.js";

describe("relay access-mode lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupBackgroundHarnesses();
    vi.unstubAllGlobals();
  });

  it("persists Cancel as an all-mode session deny, restores with Allow, and prunes on close", async () => {
    const harness = await loadBackground({
      storedConfig: {
        relayUrl: "ws://127.0.0.1:18797/extension",
        token: TEST_RELAY_KEY,
        authVersion: 2,
        accessMode: "all",
      },
      initialTabs: [{ id: 81, url: "https://example.com/cancel", groupId: -1 }],
    });
    const socket = harness.relaySockets[0];
    if (!socket || !harness.debuggerDetachListener || !harness.tabsRemovedListener) {
      throw new Error("expected relay and Chrome lifecycle listeners");
    }
    await harness.authenticate(socket);
    socket.receive({ type: "attach", seq: 30, tabId: 81 });
    await vi.waitFor(() => expect(harness.debuggerAttach).toHaveBeenCalled());

    harness.debuggerDetachListener({ tabId: 81 }, "canceled_by_user");
    await vi.waitFor(() => {
      expect(harness.sessionStorageValues.deniedTabIdsV1).toEqual([81]);
    });
    socket.receive({ type: "attach", seq: 31, tabId: 81 });
    await vi.waitFor(() => {
      const frames = socket.send.mock.calls.map(([raw]) => JSON.parse(raw));
      expect(frames).toContainEqual({
        type: "error",
        seq: 31,
        message: "tab 81 is paused for OpenClaw",
      });
    });

    await expect(
      sendRuntimeMessage(harness, {
        type: "toggleTabAccess",
        tabId: 81,
        accessMode: "all",
        grant: true,
      }),
    ).resolves.toMatchObject({ ok: true, accessible: true, denied: false });
    expect(harness.sessionStorageValues).not.toHaveProperty("deniedTabIdsV1");

    harness.debuggerDetachListener({ tabId: 81 }, "canceled_by_user");
    await vi.waitFor(() => {
      expect(harness.sessionStorageValues.deniedTabIdsV1).toEqual([81]);
    });
    harness.tabsRemovedListener(81);
    await vi.waitFor(() => {
      expect(harness.sessionStorageValues).not.toHaveProperty("deniedTabIdsV1");
    });
  });

  it("restores a validated Cancel deny after an MV3 worker restart", async () => {
    const storedConfig = {
      relayUrl: "ws://127.0.0.1:18797/extension",
      token: TEST_RELAY_KEY,
      authVersion: 2,
      accessMode: "all",
    };
    const initialTabs = [{ id: 91, url: "https://example.com/reload", groupId: -1 }];
    const harness = await loadBackground({
      storedConfig,
      sessionConfig: { deniedTabIdsV1: [91] },
      initialTabs,
    });
    const socket = harness.relaySockets[0];
    if (!socket) {
      throw new Error("expected relay socket");
    }
    await harness.authenticate(socket);
    const hello = socket.send.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .find((frame) => frame.type === "hello");
    expect(hello.tabs).toEqual([]);
    socket.receive({ type: "attach", seq: 32, tabId: 91 });
    await vi.waitFor(() => {
      const frames = socket.send.mock.calls.map(([raw]) => JSON.parse(raw));
      expect(frames).toContainEqual({
        type: "error",
        seq: 32,
        message: "tab 91 is paused for OpenClaw",
      });
    });
  });

  it.each(["all", "selected"] as const)(
    "keeps agent-created tabs in the OpenClaw group in %s mode",
    async (accessMode) => {
      const harness = await loadBackground({
        storedConfig: {
          relayUrl: "ws://127.0.0.1:18797/extension",
          token: TEST_RELAY_KEY,
          authVersion: 2,
          accessMode,
        },
      });
      const socket = harness.relaySockets[0];
      if (!socket) {
        throw new Error("expected relay socket");
      }
      await harness.authenticate(socket);
      harness.tabsCreate.mockResolvedValueOnce({
        id: 101,
        url: "https://example.com/created",
        active: true,
        groupId: -1,
        windowId: 1,
        incognito: false,
      });
      socket.receive({ type: "createTab", seq: 33, url: "https://example.com/created" });
      await vi.waitFor(() => {
        expect(harness.tabsGroup).toHaveBeenCalledWith({ tabIds: [101] });
      });
    },
  );

  it.each([
    { accessMode: "all" as const, detached: false },
    { accessMode: "selected" as const, detached: true },
  ])("revokes on group removal only in $accessMode mode", async ({ accessMode, detached }) => {
    const harness = await loadBackground({
      storedConfig: {
        relayUrl: "ws://127.0.0.1:18797/extension",
        token: TEST_RELAY_KEY,
        authVersion: 2,
        accessMode,
      },
      initialTabs: [{ id: 111, url: "https://example.com/group", groupId: 7 }],
    });
    harness.shareTab(111);
    const socket = harness.relaySockets[0];
    if (!socket || !harness.tabGroupRemovedListener) {
      throw new Error("expected relay and tab-group listener");
    }
    await harness.authenticate(socket);
    socket.receive({ type: "attach", seq: 34, tabId: 111 });
    await vi.waitFor(() => expect(harness.debuggerAttach).toHaveBeenCalled());
    harness.debuggerDetach.mockClear();

    harness.unshareTab(111);
    harness.tabGroupRemovedListener();

    if (detached) {
      await vi.waitFor(() => {
        expect(harness.debuggerDetach).toHaveBeenCalledWith({ tabId: 111 });
      });
    } else {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
      expect(harness.debuggerDetach).not.toHaveBeenCalled();
    }
  });
});
