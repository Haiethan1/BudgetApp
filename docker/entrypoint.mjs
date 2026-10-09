import { fileURLToPath } from "node:url";
import { runManagedServer } from "../operations/server.mjs";
await runManagedServer([fileURLToPath(new URL("../server.js", import.meta.url))]);
