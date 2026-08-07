# Wrangler deployment source of truth

`worker/wrangler.jsonc` is the only source of deployment configuration for Sandbox, Staging, and Production.

The CI workflows call `scripts/generate-wrangler-config.mjs` to flatten one named environment into a temporary `.wrangler.<environment>.ci.toml`. The generator reads only repository files. It never reads a deployed Worker, Worker settings, version metadata, or Cloudflare lifecycle metadata.

Durable Object classes are declared once in the top-level `exports` map and inherited by every environment. A live class must declare `type = durable-object`, a storage backend, and an export with the same name in `src/index.ts`.

When a Durable Object is intentionally removed, replace its live declaration with an explicit Wrangler 4 tombstone. A deletion must not retain a storage field:

```jsonc
"OldCoordinator": {
  "type": "durable-object",
  "state": "deleted"
}
```

Do not add `migrations` or restore remote metadata discovery. The generator rejects both legacy migrations and malformed tombstones before deployment.
