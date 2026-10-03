import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const project = `homebooks-drill-${randomUUID().slice(0, 8)}`;
const value = randomUUID();
function compose(...args) {
  const result = spawnSync("docker", ["compose", "-p", project, ...args], {
    stdio: "inherit",
    env: { ...process.env, HOMEBOOKS_PORT: "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Docker compose ${args[0]} failed.`);
}

// All volumes belong to this unique drill project. Household volumes are untouched.
try {
  compose("up", "--build", "--wait", "--wait-timeout", "180");
  compose("exec", "-T", "app", "node", "docker/persistence-check.mjs", "write", value);
  compose("restart", "app");
  compose("up", "--wait", "--wait-timeout", "180");
  compose("exec", "-T", "app", "node", "docker/persistence-check.mjs", "read", value);
  console.log("Docker startup migration and restart persistence drill passed.");
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
