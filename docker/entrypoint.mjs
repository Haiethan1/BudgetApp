import { startDatabase } from "../operations/startup.mjs";
const lease = await startDatabase();
process.once("exit", () => lease.release());
console.log("Database migrations are up to date.");
await import("../server.js");
