import crypto from "node:crypto";
import fs from "node:fs/promises";
import { WebSocket } from "ws";

const AUTH_LABEL = "openclaw.browser-relay.auth";
const AUTH_VERSION = 2;
const SUBPROTOCOL = "openclaw-extension-relay.v2";
const FIXTURE_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

function relayProof(token, kind, fields, clientProof) {
  const values = [
    AUTH_LABEL,
    AUTH_VERSION,
    kind,
    fields.keyId,
    fields.instanceId,
    fields.sessionId,
    fields.clientNonce,
    fields.serverNonce,
    fields.issuedAtMs,
    fields.expiresAtMs,
    fields.role,
    fields.transport,
    fields.method,
    fields.resource,
    fields.flow,
  ];
  if (kind === "accept") {
    values.push(clientProof);
  }
  return crypto
    .createHmac("sha256", Buffer.from(token, "hex"))
    .update(Buffer.from(JSON.stringify(values), "utf8"))
    .digest("base64url");
}

function parsePairing(raw) {
  const split = raw.trim().lastIndexOf("#");
  if (split <= 0) {
    throw new Error("invalid pairing fixture");
  }
  const token = raw.slice(split + 1).trim();
  if (!/^[0-9a-f]{64}$/u.test(token)) {
    throw new Error("invalid pairing token fixture");
  }
  const relayUrl = new URL(raw.slice(0, split));
  relayUrl.searchParams.delete("gateway");
  relayUrl.searchParams.sort();
  return { relayUrl: relayUrl.toString(), token };
}

const pairingPath = process.argv[2];
const readyPath = process.argv[3];
if (!pairingPath || !readyPath) {
  throw new Error("usage: personal-chrome-relay-peer.mjs <pairing-file> <ready-file>");
}

const { relayUrl, token } = parsePairing(await fs.readFile(pairingPath, "utf8"));
const clientNonce = crypto.randomBytes(32).toString("base64url");
const keyId = crypto
  .createHash("sha256")
  .update(Buffer.from(token, "hex"))
  .digest("base64url")
  .slice(0, 22);
const socket = new WebSocket(relayUrl, SUBPROTOCOL, {
  origin: `chrome-extension://${FIXTURE_EXTENSION_ID}`,
});

let authenticated = false;
let clientProof = "";
let challenge;
socket.on("open", () => {
  socket.send(JSON.stringify({ type: "auth.hello", v: 2, keyId, clientNonce }));
});
socket.on("message", (data) => {
  const payload = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
  const message = JSON.parse(payload.toString("utf8"));
  if (!authenticated && message.type === "auth.challenge") {
    if (relayProof(token, "server", message) !== message.serverProof) {
      throw new Error("relay server proof mismatch");
    }
    clientProof = relayProof(token, "client", message);
    challenge = message;
    socket.send(
      JSON.stringify({
        type: "auth.response",
        v: 2,
        sessionId: message.sessionId,
        clientProof,
      }),
    );
    return;
  }
  if (!authenticated && message.type === "auth.ok") {
    if (
      !challenge ||
      message.sessionId !== challenge.sessionId ||
      relayProof(token, "accept", challenge, clientProof) !== message.acceptProof
    ) {
      throw new Error("relay accept proof mismatch");
    }
    authenticated = true;
    socket.send(
      JSON.stringify({
        type: "hello",
        userAgent: "openclaw-isolation-peer",
        browserVersion: "Chrome/disposable-fixture",
        extensionVersion: "isolation",
        tabs: [],
      }),
    );
    void fs.writeFile(readyPath, "ready\n", { mode: 0o600, flag: "wx" });
    return;
  }
  if (authenticated && message.type === "ping") {
    socket.send(JSON.stringify({ type: "pong" }));
  }
});
socket.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

const close = () => socket.close();
process.once("SIGINT", close);
process.once("SIGTERM", close);
