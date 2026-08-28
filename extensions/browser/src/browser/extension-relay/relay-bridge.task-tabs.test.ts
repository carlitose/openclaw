import { describe, expect, it, vi } from "vitest";
import { ExtensionRelayBridge } from "./relay-bridge.js";
import type { ExtensionToRelayMessage, RelayToExtensionMessage } from "./relay-protocol.js";

class FakeSocket {
  readonly sent: unknown[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {}
  frames(): Array<Record<string, unknown>> {
    return this.sent as Array<Record<string, unknown>>;
  }
}

function defaultTabs() {
  return [{ tabId: 1, url: "https://example.com", title: "Example", active: true }];
}

function replyFor(msg: RelayToExtensionMessage): ExtensionToRelayMessage | null {
  switch (msg.type) {
    case "attach":
      return { type: "result", seq: msg.seq, result: { targetId: `target-${msg.tabId}` } };
    case "detach":
    case "activateTab":
    case "closeTab":
      return { type: "result", seq: msg.seq, result: {} };
    case "createTab":
      return {
        type: "result",
        seq: msg.seq,
        result: { tabId: 999, targetId: "target-999", taskGeneration: "task-generation-999" },
      };
    case "cdp":
      return { type: "result", seq: msg.seq, result: { ok: true, echoed: msg.method } };
    default:
      return null;
  }
}

function wireExtension(bridge: ExtensionRelayBridge, opts: { syncCreatedTab?: boolean } = {}) {
  const socket = new FakeSocket();
  const handlers = bridge.attachExtensionSocket(socket);
  const originalSend = socket.send.bind(socket);
  socket.send = (data: string) => {
    originalSend(data);
    const msg = JSON.parse(data) as RelayToExtensionMessage;
    if (msg.type === "ping") {
      return;
    }
    queueMicrotask(() => {
      const reply = replyFor(msg);
      if (!reply) {
        return;
      }
      handlers.onMessage(JSON.stringify(reply));
      if (msg.type === "createTab" && opts.syncCreatedTab !== false) {
        queueMicrotask(() => {
          handlers.onMessage(
            JSON.stringify({
              type: "tabs",
              tabs: [
                ...defaultTabs(),
                { tabId: 999, url: msg.url, title: "", active: !msg.background },
              ],
            }),
          );
        });
      }
    });
  };
  return { socket, handlers };
}

function sendHello(handlers: { onMessage: (raw: string) => void }, tabs = defaultTabs()) {
  handlers.onMessage(
    JSON.stringify({
      type: "hello",
      userAgent: "Mozilla/5.0 Chrome/144.0.0.0",
      browserVersion: "Chrome/144.0.0.0",
      extensionVersion: "2.0.0",
      tabs,
    }),
  );
}

const flush = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("ExtensionRelayBridge task tabs", () => {
  it("creates a tab inside the group and returns its synthetic target", async () => {
    const bridge = new ExtensionRelayBridge();
    const { socket, handlers } = wireExtension(bridge);
    sendHello(handlers);

    const client = new FakeSocket();
    const cdp = bridge.attachCdpClientSocket(client);
    cdp.onMessage(
      JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } }),
    );
    await flush();
    cdp.onMessage(
      JSON.stringify({ id: 2, method: "Target.createTarget", params: { url: "https://new.test" } }),
    );
    await flush();

    expect(client.frames().find((frame) => frame.id === 2)?.result).toMatchObject({
      targetId: "target-999",
    });
    expect(socket.frames().find((frame) => frame.type === "createTab")).toMatchObject({
      url: "https://new.test",
      background: true,
      focus: false,
    });
  });

  it("keeps about:blank task bootstrap out of accessible inventory", async () => {
    const bridge = new ExtensionRelayBridge();
    const { socket, handlers } = wireExtension(bridge, { syncCreatedTab: false });
    sendHello(handlers);

    const client = new FakeSocket();
    const cdp = bridge.attachCdpClientSocket(client);
    cdp.onMessage(
      JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } }),
    );
    await flush();
    cdp.onMessage(
      JSON.stringify({ id: 2, method: "Target.createTarget", params: { url: "about:blank" } }),
    );
    await flush();

    expect(socket.frames()).toContainEqual(
      expect.objectContaining({ type: "createTab", url: "about:blank" }),
    );
    expect(socket.frames()).not.toContainEqual(
      expect.objectContaining({ type: "attach", tabId: 999 }),
    );
    expect(client.frames()).toContainEqual({ id: 2, result: { targetId: "target-999" } });
    expect(bridge.accessibleTabs()).not.toContainEqual(expect.objectContaining({ tabId: 999 }));

    const attached = client
      .frames()
      .find(
        (frame) =>
          frame.method === "Target.attachedToTarget" &&
          (frame.params as { targetInfo?: { targetId?: string } }).targetInfo?.targetId ===
            "target-999",
      );
    if (!attached) {
      throw new Error("expected attached task target");
    }
    const sessionId = (attached.params as { sessionId?: string }).sessionId;
    expect(sessionId).toBeTruthy();
    const otherClient = new FakeSocket();
    const otherCdp = bridge.attachCdpClientSocket(otherClient);
    otherCdp.onMessage(JSON.stringify({ id: 20, sessionId, method: "Page.enable" }));
    await flush();
    expect(otherClient.frames().find((frame) => frame.id === 20)?.error).toBeTruthy();

    cdp.onMessage(
      JSON.stringify({
        id: 22,
        sessionId,
        method: "Runtime.evaluate",
        params: { expression: "location.href='https://example.com'" },
      }),
    );
    await flush();
    expect(client.frames().find((frame) => frame.id === 22)?.error).toBeTruthy();
    cdp.onMessage(
      JSON.stringify({
        id: 21,
        sessionId,
        method: "Page.enable",
      }),
    );
    await flush();
    expect(socket.frames()).toContainEqual(
      expect.objectContaining({
        type: "cdp",
        tabId: 999,
        method: "Page.enable",
        taskGeneration: "task-generation-999",
      }),
    );
    expect(client.frames().find((frame) => frame.id === 21)?.result).toMatchObject({ ok: true });
    cdp.onMessage(
      JSON.stringify({
        id: 3,
        sessionId,
        method: "Page.navigate",
        params: { url: "https://example.com" },
      }),
    );
    await flush();
    expect(socket.frames()).toContainEqual(
      expect.objectContaining({
        type: "cdp",
        tabId: 999,
        method: "Page.navigate",
        taskGeneration: "task-generation-999",
      }),
    );
    expect(client.frames().find((frame) => frame.id === 3)?.result).toMatchObject({ ok: true });

    handlers.onMessage(
      JSON.stringify({
        type: "taskTabRemoved",
        tabId: 999,
        taskGeneration: "task-generation-999",
      }),
    );
    cdp.onMessage(
      JSON.stringify({
        id: 4,
        method: "Target.closeTarget",
        params: { targetId: "target-999" },
      }),
    );
    await flush();
    expect(client.frames().find((frame) => frame.id === 4)?.error).toBeTruthy();
    bridge.dispose();
  });

  it("cleans an exact task generation returned after create timeout", async () => {
    vi.useFakeTimers();
    const bridge = new ExtensionRelayBridge();
    try {
      const socket = new FakeSocket();
      const handlers = bridge.attachExtensionSocket(socket);
      sendHello(handlers);
      const client = new FakeSocket();
      const cdp = bridge.attachCdpClientSocket(client);
      cdp.onMessage(
        JSON.stringify({
          id: 1,
          method: "Target.createTarget",
          params: { url: "https://new.test" },
        }),
      );
      await vi.advanceTimersByTimeAsync(0);
      const create = socket.frames().find((frame) => frame.type === "createTab") as { seq: number };

      await vi.advanceTimersByTimeAsync(15_000);
      handlers.onMessage(
        JSON.stringify({
          type: "result",
          seq: create.seq,
          result: {
            tabId: 999,
            targetId: "target-999",
            taskGeneration: "task-generation-999",
          },
        }),
      );
      vi.runAllTicks();

      expect(client.frames().find((frame) => frame.id === 1)?.error).toBeTruthy();
      expect(socket.frames()).toContainEqual(
        expect.objectContaining({
          type: "cleanupTask",
          tabId: 999,
          taskGeneration: "task-generation-999",
        }),
      );
    } finally {
      bridge.dispose();
      vi.useRealTimers();
    }
  });

  it("does not reattach a completed task through a different extension", async () => {
    const bridge = new ExtensionRelayBridge();
    const initial = wireExtension(bridge, { syncCreatedTab: false });
    sendHello(initial.handlers);

    const client = new FakeSocket();
    const cdp = bridge.attachCdpClientSocket(client);
    cdp.onMessage(
      JSON.stringify({ id: 1, method: "Target.createTarget", params: { url: "https://new.test" } }),
    );
    await flush();

    const replacement = wireExtension(bridge);
    sendHello(replacement.handlers, [
      { tabId: 999, url: "https://replacement.test", title: "", active: true },
    ]);
    await flush();

    expect(client.frames().find((frame) => frame.id === 1)).toMatchObject({
      result: { targetId: "target-999" },
    });
    expect(replacement.socket.frames()).not.toContainEqual(
      expect.objectContaining({ type: "attach", tabId: 999 }),
    );
    bridge.dispose();
  });

  it("preserves an explicit foreground Target.createTarget request", async () => {
    const bridge = new ExtensionRelayBridge();
    const { socket, handlers } = wireExtension(bridge);
    sendHello(handlers);

    const client = new FakeSocket();
    const cdp = bridge.attachCdpClientSocket(client);
    cdp.onMessage(
      JSON.stringify({
        id: 1,
        method: "Target.createTarget",
        params: { url: "https://foreground.test", background: false },
      }),
    );
    await flush();

    expect(client.frames().find((frame) => frame.id === 1)?.result).toMatchObject({
      targetId: "target-999",
    });
    expect(socket.frames().find((frame) => frame.type === "createTab")).toMatchObject({
      url: "https://foreground.test",
      background: false,
      focus: true,
    });
  });

  it.each([true, false])(
    "honors an explicit Target.createTarget focus=%s request",
    async (focus) => {
      const bridge = new ExtensionRelayBridge();
      const { socket, handlers } = wireExtension(bridge);
      sendHello(handlers);

      const client = new FakeSocket();
      const cdp = bridge.attachCdpClientSocket(client);
      cdp.onMessage(
        JSON.stringify({
          id: 1,
          method: "Target.createTarget",
          params: { url: "https://focused.test", focus },
        }),
      );
      await flush();

      expect(client.frames().find((frame) => frame.id === 1)?.result).toMatchObject({
        targetId: "target-999",
      });
      expect(socket.frames().find((frame) => frame.type === "createTab")).toMatchObject({
        url: "https://focused.test",
        background: false,
        focus,
      });
    },
  );
});
