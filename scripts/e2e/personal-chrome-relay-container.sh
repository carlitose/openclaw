#!/usr/bin/env bash
set -euo pipefail

cd /app
source scripts/lib/openclaw-e2e-instance.sh

GATEWAY_PID=""
PEER_PID=""
OPENCLAW_TEST_STATE_HOME=""

owned_state_home() {
  [ -n "$OPENCLAW_TEST_STATE_HOME" ] && [ -n "${OPENCLAW_TEST_STATE_TMP_ROOT:-}" ] || return 1
  local resolved_home resolved_tmp
  resolved_home="$(realpath -e -- "$OPENCLAW_TEST_STATE_HOME")" || return 1
  resolved_tmp="$(realpath -e -- "$OPENCLAW_TEST_STATE_TMP_ROOT")" || return 1
  [ "$(dirname -- "$resolved_home")" = "$resolved_tmp" ] || return 1
  case "$(basename -- "$resolved_home")" in
    openclaw-personal-chrome-relay-minimal-home.*) printf '%s\n' "$resolved_home" ;;
    *) return 1 ;;
  esac
}

cleanup() {
  openclaw_e2e_stop_process "$PEER_PID"
  openclaw_e2e_stop_process "$GATEWAY_PID"
  if [ -n "$OPENCLAW_TEST_STATE_HOME" ]; then
    local cleanup_root
    cleanup_root="$(owned_state_home)" || {
      printf 'refusing to remove unverified isolation root: %s\n' "$OPENCLAW_TEST_STATE_HOME" >&2
      return 1
    }
    rm -rf -- "$cleanup_root"
  fi
}
trap cleanup EXIT INT TERM

eval "$(tsx scripts/lib/openclaw-test-state.mts shell --label personal-chrome-relay --scenario minimal)"
owned_state_home >/dev/null || {
  printf 'test-state helper returned an unverified isolation root\n' >&2
  exit 1
}
ENTRY="$(openclaw_e2e_resolve_entrypoint)"
read -r PORT RELAY_PORT < <(node --input-type=module <<'NODE'
import net from "node:net";

const free = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", () => resolve(false));
  server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
});
for (let attempt = 0; attempt < 100; attempt += 1) {
  const base = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
  if (base !== 18789 && base <= 65000 && await free(base + 2) && await free(base + 10)) {
    process.stdout.write(`${base} ${base + 10}\n`);
    process.exit(0);
  }
}
throw new Error("could not allocate isolated Gateway and relay ports");
NODE
)
TOKEN="$(node -p 'require("node:crypto").randomBytes(24).toString("hex")')"
export PORT TOKEN
node -e '
  const fs = require("node:fs");
  const config = {
    gateway: {
      mode: "local",
      port: Number(process.env.PORT),
      bind: "loopback",
      auth: { mode: "token", token: process.env.TOKEN },
      controlUi: { enabled: false },
    },
    browser: {
      enabled: true,
      defaultProfile: "chrome",
      extensionRelay: { allowLegacyAuth: false },
    },
  };
  fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
'

GATEWAY_LOG="$OPENCLAW_TEST_STATE_HOME/gateway.log"
GATEWAY_PID="$(openclaw_e2e_start_gateway "$ENTRY" "$PORT" "$GATEWAY_LOG")"
openclaw_e2e_wait_gateway_ready "$GATEWAY_PID" "$GATEWAY_LOG" 240 "$PORT"

PAIRING_JSON="$OPENCLAW_STATE_DIR/pairing.json"
PAIRING_FILE="$OPENCLAW_STATE_DIR/pairing.txt"
READY_FILE="$OPENCLAW_STATE_DIR/peer.ready"
umask 077
node "$ENTRY" browser extension pair \
  --gateway-url "ws://127.0.0.1:$PORT" \
  --json >"$PAIRING_JSON"
node -e '
  const fs = require("node:fs");
  const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (typeof parsed.pairingString !== "string" || !parsed.pairingString.includes("#")) {
    throw new Error("packaged CLI did not return a pairing string");
  }
  fs.writeFileSync(process.argv[2], `${parsed.pairingString}\n`, { mode: 0o600, flag: "wx" });
' "$PAIRING_JSON" "$PAIRING_FILE"
rm -f "$PAIRING_JSON"

PEER_LOG="$OPENCLAW_TEST_STATE_HOME/peer.log"
PEER_PID="$(openclaw_e2e_start_tracked_process "$PEER_LOG" node scripts/e2e/personal-chrome-relay-peer.mjs "$PAIRING_FILE" "$READY_FILE")"
for _ in $(seq 1 160); do
  [ -f "$READY_FILE" ] && break
  openclaw_e2e_process_alive "$PEER_PID" || {
    openclaw_e2e_print_log "$PEER_LOG" >&2
    exit 1
  }
  sleep 0.1
done
[ -f "$READY_FILE" ]

TABS_JSON="$OPENCLAW_TEST_STATE_HOME/tabs.json"
node "$ENTRY" browser \
  --url "ws://127.0.0.1:$PORT" \
  --token "$TOKEN" \
  --json \
  --browser-profile chrome \
  tabs >"$TABS_JSON"
node -e '
  const fs = require("node:fs");
  const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(parsed.tabs)) throw new Error("packaged relay tabs result is malformed");
' "$TABS_JSON"

openclaw_e2e_stop_process "$PEER_PID"
PEER_PID=""
openclaw_e2e_stop_process "$GATEWAY_PID"
GATEWAY_PID=""
! openclaw_e2e_probe_tcp 127.0.0.1 "$PORT"
! openclaw_e2e_probe_tcp 127.0.0.1 "$RELAY_PORT"

printf 'PERSONAL_CHROME_ISOLATION_DOCKER_OK claim=package-relay gatewayPort=%s relayPort=%s\n' \
  "$PORT" "$RELAY_PORT"
