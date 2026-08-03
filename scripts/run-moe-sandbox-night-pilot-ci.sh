#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-run}"
BASE_CONFIG="${BASE_CONFIG:-wrangler.sandbox.jsonc}"
WORKER_URL="${WORKER_URL:-https://moerand-alerts-sandbox.mosaprajb.workers.dev}"
PILOT_SECONDS="${PILOT_SECONDS:-300}"
PROPAGATION_SECONDS="${PROPAGATION_SECONDS:-75}"
RUN_STAMP="${GITHUB_RUN_ID:-local}-$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_DIR="${REPORT_DIR:-$ROOT_DIR/reports/sandbox-night-pilot-$RUN_STAMP}"
REPORT_FILE="$REPORT_DIR/REPORT_FILE.txt"
ARMED_CONFIG="$ROOT_DIR/.wrangler.sandbox-night-pilot.armed.jsonc"
DISARMED_CONFIG="$ROOT_DIR/.wrangler.sandbox-night-pilot.disarmed.jsonc"
ARMED_DEPLOYED=0

mkdir -p "$REPORT_DIR"
touch "$REPORT_FILE"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$REPORT_FILE"
}

fail() {
  log "ERROR: $*"
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "Required GitHub secret/environment variable is missing: $name"
}

validate_seconds() {
  [[ "$PILOT_SECONDS" =~ ^[0-9]+$ ]] || fail "PILOT_SECONDS must be an integer."
  (( PILOT_SECONDS >= 180 && PILOT_SECONDS <= 900 )) \
    || fail "PILOT_SECONDS must be between 180 and 900 seconds."
  [[ "$PROPAGATION_SECONDS" =~ ^[0-9]+$ ]] || fail "PROPAGATION_SECONDS must be an integer."
  (( PROPAGATION_SECONDS >= 30 && PROPAGATION_SECONDS <= 180 )) \
    || fail "PROPAGATION_SECONDS must be between 30 and 180 seconds."
}

generate_configs() {
  [[ -f "$BASE_CONFIG" ]] || fail "Base Wrangler config was not found: $BASE_CONFIG"

  node - "$BASE_CONFIG" "$ARMED_CONFIG" "$DISARMED_CONFIG" <<'NODE'
const fs = require('fs');
const [sourcePath, armedPath, disarmedPath] = process.argv.slice(2);

function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];

    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
        output += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (current === '\n') {
        output += current;
      }
      continue;
    }
    if (inString) {
      output += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }
    if (current === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    output += current;
  }
  return output.replace(/^\uFEFF/, '');
}

function loadConfig(path) {
  return JSON.parse(stripJsonComments(fs.readFileSync(path, 'utf8')));
}

function securedConfig(base, pilotEnabled) {
  const config = structuredClone(base);
  config.vars = { ...(config.vars || {}) };
  Object.assign(config.vars, {
    MOE_RUNTIME_ENVIRONMENT: 'SANDBOX_PILOT',
    MOE_TRADING_MODE_DEFAULT: 'SANDBOX',
    MOE_SANDBOX_PILOT_ENABLED: pilotEnabled ? 'true' : 'false',
    MOE_SANDBOX_PILOT_MAX_SUBMISSIONS_TOTAL: '1',
    AUTO_SCANNER_ENABLED: 'true',
    AUTO_SCANNER_TRADING_HOURS: 'AUTO',
    AUTO_SCANNER_OVERNIGHT_ENABLED: pilotEnabled ? 'true' : 'false',
    AUTO_SCANNER_ALLOW_DELAYED_OVERNIGHT_SANDBOX: pilotEnabled ? 'true' : 'false',
    WEBULL_ENVIRONMENT: 'sandbox',
    WEBULL_SANDBOX_ENABLED: 'true',
    WEBULL_SANDBOX_ORDER_SUBMISSION: 'true',
    WEBULL_AUTO_SUBMIT_SANDBOX: 'true',
    MOE_LIVE_MODE_UNLOCKED: 'false',
    MOE_LIVE_EXECUTION_IMPLEMENTED: 'false',
    WEBULL_LIVE_TRADING: 'false',
    WEBULL_LIVE_ORDER_SUBMISSION: 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: 'false',
    WEBULL_LIVE_KILL_SWITCH: 'true',
    MOE_LEARNING_LIVE_TRADING_CHANGES: 'false',
  });
  return config;
}

const base = loadConfig(sourcePath);
fs.writeFileSync(armedPath, `${JSON.stringify(securedConfig(base, true), null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(disarmedPath, `${JSON.stringify(securedConfig(base, false), null, 2)}\n`, { mode: 0o600 });
NODE
}

wrangler_dry_run() {
  local config="$1"
  local label="$2"
  local output_dir="$REPORT_DIR/dry-run-$label"
  rm -rf "$output_dir"
  log "Validating Wrangler bundle ($label) without publishing."
  npx wrangler deploy --dry-run --config "$config" --outdir "$output_dir" 2>&1 | tee -a "$REPORT_FILE"
}

deploy_config() {
  local config="$1"
  local label="$2"
  log "Deploying Sandbox configuration: $label"
  npx wrangler deploy --config "$config" --keep-vars 2>&1 | tee -a "$REPORT_FILE"
}

curl_json() {
  local label="$1"
  local endpoint="$2"
  local output="$3"
  log "Probing $label"
  curl --fail --silent --show-error \
    --retry 4 --retry-delay 5 --retry-all-errors \
    --connect-timeout 15 --max-time 45 \
    -H 'accept: application/json' \
    -H "x-moe-webhook-secret: $MOE_WEBHOOK_SECRET" \
    "$endpoint" > "$output"
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$output"
}

collect_snapshot() {
  local phase="$1"
  local sequence="$2"
  local prefix="$REPORT_DIR/${phase,,}-$sequence"
  local base="${WORKER_URL%/}"

  curl_json health "$base/api/health?view=public" "$prefix-health.json"
  curl_json readiness "$base/api/readiness?view=public" "$prefix-readiness.json"
  curl_json audit "$base/api/sandbox/audit?view=public" "$prefix-audit.json"
  curl_json orders "$base/api/sandbox/orders/status?view=public" "$prefix-orders.json"

  node - "$phase" \
    "$prefix-health.json" \
    "$prefix-readiness.json" \
    "$prefix-audit.json" \
    "$prefix-orders.json" <<'NODE' | tee -a "$REPORT_FILE"
const fs = require('fs');
const [phase, healthPath, readinessPath, auditPath, ordersPath] = process.argv.slice(2);
const read = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const health = read(healthPath);
const readiness = read(readinessPath);
const audit = read(auditPath);
const orders = read(ordersPath);
const errors = [];
const expect = (condition, message) => { if (!condition) errors.push(message); };

expect(health.environment === 'SANDBOX', 'Health environment is not SANDBOX.');
expect(health.liveLocked === true, 'Live is not locked in health response.');
expect(health.liveFundsAllowed === false, 'Live funds are allowed in health response.');
expect(readiness.live?.locked === true, 'Live is not locked in readiness response.');
expect(readiness.live?.killSwitchActive === true, 'Live kill switch is not active.');
expect(readiness.live?.fundsAllowed === false, 'Live funds are allowed in readiness response.');
expect(audit.mode === 'SANDBOX', 'Audit mode is not SANDBOX.');
expect(audit.liveFundsUsed === false, 'Audit reports live funds usage.');
expect(orders.mode === 'SANDBOX', 'Orders mode is not SANDBOX.');
expect(orders.liveFundsUsed === false, 'Orders report live funds usage.');
expect(Number(orders.submissionGate?.maximumSubmissions ?? 99) <= 1, 'Submission maximum exceeds one.');

if (phase === 'ARMED') {
  expect(health.pilotArmed === true, 'Pilot is not armed in health response.');
  expect(readiness.pilotArmed === true, 'Pilot is not armed in readiness response.');
  expect(audit.session?.current === 'NIGHT', 'Sandbox session is not NIGHT.');
  expect(audit.session?.open === true, 'Sandbox NIGHT session is not open.');
} else {
  expect(health.pilotArmed === false, 'Pilot remained armed after disarm deployment.');
  expect(readiness.pilotArmed === false, 'Readiness still reports an armed pilot.');
}

const summary = {
  phase,
  healthStatus: health.status,
  readinessStatus: readiness.status,
  pilotArmed: health.pilotArmed,
  session: audit.session,
  scanner: audit.scanner,
  submissions: orders.summary,
  submissionGate: orders.submissionGate,
  liveLocked: health.liveLocked,
  liveFundsUsed: audit.liveFundsUsed,
  checkedAt: new Date().toISOString(),
};
console.log(JSON.stringify(summary));

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
NODE
}

remove_temp_configs() {
  rm -f "$ARMED_CONFIG" "$DISARMED_CONFIG"
}

cleanup() {
  local original_status=$?
  local cleanup_status=0
  trap - EXIT INT TERM
  set +e

  if (( ARMED_DEPLOYED == 1 )); then
    log "Safety cleanup: restoring DISARMED Sandbox configuration."
    deploy_config "$DISARMED_CONFIG" DISARMED || cleanup_status=$?
    if (( cleanup_status == 0 )); then
      sleep 45
      collect_snapshot DISARMED final || cleanup_status=$?
    fi
  fi

  remove_temp_configs
  log "REPORT_FILE=$REPORT_FILE"

  if (( original_status != 0 )); then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}

main() {
  require_command node
  require_command npx
  require_command curl
  require_env CLOUDFLARE_API_TOKEN
  require_env CLOUDFLARE_ACCOUNT_ID
  require_env MOE_WEBHOOK_SECRET
  validate_seconds
  generate_configs

  if [[ "$MODE" == '--disarm-only' ]]; then
    wrangler_dry_run "$DISARMED_CONFIG" disarmed
    deploy_config "$DISARMED_CONFIG" DISARMED
    sleep 45
    collect_snapshot DISARMED forced
    remove_temp_configs
    log "REPORT_FILE=$REPORT_FILE"
    return 0
  fi

  [[ "$MODE" == 'run' ]] || fail "Unsupported mode: $MODE"
  trap cleanup EXIT INT TERM

  wrangler_dry_run "$ARMED_CONFIG" armed
  wrangler_dry_run "$DISARMED_CONFIG" disarmed
  deploy_config "$ARMED_CONFIG" ARMED_NIGHT_PILOT
  ARMED_DEPLOYED=1

  log "Waiting $PROPAGATION_SECONDS seconds for Worker propagation."
  sleep "$PROPAGATION_SECONDS"

  local start_epoch deadline now sequence remaining sleep_seconds
  start_epoch="$(date +%s)"
  deadline=$(( start_epoch + PILOT_SECONDS ))
  sequence=1

  while true; do
    collect_snapshot ARMED "$sequence"
    now="$(date +%s)"
    (( now >= deadline )) && break
    remaining=$(( deadline - now ))
    sleep_seconds=60
    (( remaining < sleep_seconds )) && sleep_seconds="$remaining"
    log "Pilot remains armed for approximately $remaining more seconds."
    sleep "$sleep_seconds"
    sequence=$(( sequence + 1 ))
  done

  log "Night Pilot observation window completed."
}

main "$@"
