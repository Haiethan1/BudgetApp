import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const project = `homebooks-drill-${randomUUID().slice(0, 8)}`;
const value = randomUUID();
const env = { ...process.env, HOMEBOOKS_PORT: "0", BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), HOMEBOOKS_SETUP_TOKEN: randomBytes(32).toString("hex"), HOMEBOOKS_REGISTRATION_ENABLED: "false" };
function compose(...args) {
  const result = spawnSync("docker", ["compose", "-p", project, ...args], {
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Docker compose ${args[0]} failed.`);
}

// All volumes belong to this unique drill project. Household volumes are untouched.
try {
  if (process.env.HOMEBOOKS_DRILL_IMAGE) {
    const tagged = spawnSync("docker", ["tag", process.env.HOMEBOOKS_DRILL_IMAGE, `${project}-app`], { env, stdio: "inherit" });
    if (tagged.error) throw tagged.error;
    if (tagged.status !== 0) throw new Error("Could not reuse the supplied drill image.");
  }
  compose("up", process.env.HOMEBOOKS_DRILL_IMAGE ? "--no-build" : "--build", "--wait", "--wait-timeout", "180");
  compose("exec", "-T", "app", "node", "docker/persistence-check.mjs", "write", value);
  compose("restart", "app");
  compose("up", "--wait", "--wait-timeout", "180");
  compose("exec", "-T", "app", "node", "docker/persistence-check.mjs", "read", value);
  console.log("Docker startup migration and restart persistence drill passed.");
} finally {
  compose("down", "--volumes", "--remove-orphans");
}
