import { buildSync } from "esbuild";

buildSync({
  entryPoints: {
    "recover-password": "scripts/recover-password.ts",
    backup: "scripts/backup.ts",
    serve: "scripts/serve.ts",
    startup: "src/operations/startup.ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outdir: "operations",
  outExtension: { ".js": ".mjs" },
});
