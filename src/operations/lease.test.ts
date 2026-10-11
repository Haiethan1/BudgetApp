import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildSync } from "esbuild";
import { expect, it } from "vitest";
import { acquireLease, runtimeLeaseIsActive } from "./lease";

for (const kind of ["runtime", "operations"] as const) {
  it(`releases a ${kind} lease after a forced process kill without deleting files`, async () => {
    const root = path.resolve("operations"); fs.mkdirSync(root, { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, "lease-test-"));
    const filename = path.join(directory, "instance.sqlite");
    let child: ReturnType<typeof spawn> | undefined;
    try {
      buildSync({ entryPoints: ["src/operations/lease.ts"], outfile: path.join(directory, "lease.mjs"), bundle: true, platform: "node", format: "esm", packages: "external" });
      fs.writeFileSync(path.join(directory, "hold.mjs"), `
        import { acquireLease } from './lease.mjs';
        const lease = acquireLease(process.argv[2], process.argv[3]);
        console.log(lease.token);
        setInterval(() => {}, 1000);
      `);
      child = spawn(process.execPath, [path.join(directory, "hold.mjs"), filename, kind], { stdio: ["ignore", "pipe", "pipe"] });
      const running = child;
      const exited = new Promise<void>((resolve, reject) => { running.once("exit", () => resolve()); running.once("error", reject); });
      const token = await new Promise<string>((resolve, reject) => {
        running.stdout?.once("data", (data: Buffer) => resolve(data.toString().trim()));
        running.once("exit", (code) => reject(new Error(`Lock holder exited early: ${code}`)));
        running.once("error", reject);
      });
      expect(() => acquireLease(filename, kind)).toThrow(`Database ${kind} lease exists`);
      if (kind === "runtime") expect(runtimeLeaseIsActive(filename, token)).toBe(true);
      running.kill("SIGKILL"); await exited;
      expect(fs.existsSync(`${filename}.${kind}-lock`)).toBe(true);
      if (kind === "runtime") expect(runtimeLeaseIsActive(filename, token)).toBe(false);
      const restarted = acquireLease(filename, kind);
      try { expect(() => acquireLease(filename, kind)).toThrow(`Database ${kind} lease exists`); }
      finally { restarted.release(); }
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) => child?.once("exit", () => resolve()));
        child.kill("SIGKILL"); await exited;
      }
      const target = fs.realpathSync(directory);
      if (path.dirname(target) !== fs.realpathSync(root) || !path.basename(target).startsWith("lease-test-")) throw new Error("Unexpected lease test directory.");
      fs.rmSync(target, { recursive: true, force: true });
    }
  }, 15_000);
}
