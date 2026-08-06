import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSandboxExportsConfig,
  collectSourceExportNames,
  getLiveDurableObjectExports,
  resolveDeployedExportsMap,
  resolveSandboxLifecycleConfig,
} from "../scripts/prepare-sandbox-config.mjs";

const baseConfig = `name = "moerand-alerts"

# Deletes the legacy AlertCoordinator Durable Object namespace.
[[migrations]]
tag             = "v2-cleanup"
deleted_classes = ["AlertCoordinator"]

[env.sandbox]
name = "moerand-alerts-sandbox"

[[env.sandbox.kv_namespaces]]
binding = "CONFIG"

[[env.sandbox.d1_databases]]
binding = "DB"
migrations_dir = "migrations"
`;

test("collectSourceExportNames finds class exports and renamed re-exports", () => {
  const names = collectSourceExportNames(`
    export class AlertCoordinator {}
    class Internal {}
    export { Internal as PublicCoordinator };
  `);
  assert.deepEqual([...names].sort(), ["AlertCoordinator", "PublicCoordinator"]);
});

test("getLiveDurableObjectExports ignores named Worker entrypoints", () => {
  const exports = getLiveDurableObjectExports({
    exports: {
      default: { type: "worker", state: "created" },
      AlertCoordinator: { type: "durable-object", storage: "legacy-kv" },
    },
  });
  assert.deepEqual(exports, [{ name: "AlertCoordinator", state: "created", storage: "legacy-kv" }]);
});

test("script_runtime exports are used when the top-level map is absent", () => {
  const deployedScript = {
    script_runtime: {
      exports: {
        AlertCoordinator: { type: "durable-object", storage: "sqlite" },
      },
    },
  };

  assert.deepEqual(resolveDeployedExportsMap(deployedScript), {
    source: "script_runtime.exports",
    exportsMap: deployedScript.script_runtime.exports,
  });
  assert.deepEqual(getLiveDurableObjectExports(deployedScript), [
    { name: "AlertCoordinator", state: "created", storage: "sqlite" },
  ]);
});

test("non-empty runtime exports take precedence over an empty top-level map", () => {
  const deployedScript = {
    exports: {},
    script_runtime: {
      exports: {
        SimulationDriver: { type: "durable-object", storage: "legacy-kv" },
      },
    },
  };

  assert.equal(resolveDeployedExportsMap(deployedScript).source, "script_runtime.exports");
  assert.deepEqual(getLiveDurableObjectExports(deployedScript), [
    { name: "SimulationDriver", state: "created", storage: "legacy-kv" },
  ]);
});

test("empty remote Durable Object exports keep exports mode and remove migrations", () => {
  const resolved = resolveSandboxLifecycleConfig(
    baseConfig,
    { exports: { default: { type: "worker", state: "created" } } },
    "export default {};",
  );
  assert.match(resolved.config, /\[env\.sandbox\]\nname = "moerand-alerts-sandbox"\nexports = \{\}/);
  assert.doesNotMatch(resolved.config, /\[\[migrations\]\]/);
  assert.deepEqual(resolved.preservedNames, []);
  assert.equal(resolved.exportsSource, "exports");
});

test("live Durable Object exports are preserved when the source still exports the class", () => {
  const resolved = resolveSandboxLifecycleConfig(
    baseConfig,
    { exports: { AlertCoordinator: { type: "durable-object", storage: "legacy-kv" } } },
    "export class AlertCoordinator {}",
  );
  assert.match(resolved.config, /\[env\.sandbox\.exports\.AlertCoordinator\]/);
  assert.match(resolved.config, /storage = "legacy-kv"/);
  assert.doesNotMatch(resolved.config, /exports = \{\}/);
  assert.deepEqual(resolved.preservedNames, ["AlertCoordinator"]);
});

test("deployment stops when deployed metadata has no exports map", () => {
  assert.throws(
    () => buildSandboxExportsConfig(
      { id: "moerand-alerts-sandbox", script_runtime: {} },
      "export class AlertCoordinator {}",
    ),
    /without an exports map.*cannot be reconciled safely/,
  );
});

test("deployment stops before omitting a live remote Durable Object class", () => {
  assert.throws(
    () => buildSandboxExportsConfig(
      { exports: { AlertCoordinator: { type: "durable-object", storage: "legacy-kv" } } },
      "export default {};",
    ),
    /Refusing to deploy.*AlertCoordinator.*destroy data/,
  );
});

test("transfer lifecycle entries stop before deployment", () => {
  assert.throws(
    () => buildSandboxExportsConfig(
      { exports: { IncomingCoordinator: { type: "durable-object", state: "expecting-transfer", storage: "sqlite" } } },
      "export class IncomingCoordinator {}",
    ),
    /Transfer lifecycle entries require an explicit reviewed configuration/,
  );
});
