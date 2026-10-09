"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { backupStatusSchema, type BackupStatus } from "@/operations/status-input";
import { Badge, Button, Notice } from "./ui";

type State = { kind: "loading" } | { kind: "error" } | { kind: "denied" } | { kind: "loaded"; status: BackupStatus };
function timestamp(value: string | null) { return value ? new Date(value).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC" : "None recorded"; }
export function BackupStatusScreen() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const refreshButton = useRef<HTMLButtonElement>(null);
  const restoreRefreshFocus = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/admin/backups", { cache: "no-store", signal });
      if (signal?.aborted) return;
      if (response.status === 401) { router.replace("/sign-in?expired=1"); router.refresh(); return; }
      if (response.status === 403) { setState({ kind: "denied" }); return; }
      if (!response.ok) throw new Error("Could not load status.");
      const status = backupStatusSchema.parse(await response.json());
      if (!signal?.aborted) setState({ kind: "loaded", status });
    } catch { if (!signal?.aborted) setState({ kind: "error" }); }
  }, [router]);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => void load(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
  useEffect(() => {
    if (state.kind === "loading" || !restoreRefreshFocus.current) return;
    restoreRefreshFocus.current = false;
    if (document.activeElement === document.body) refreshButton.current?.focus();
  }, [state.kind]);
  const status = state.kind === "loaded" ? state.status : null;
  return <><section className="panel setting-panel" aria-labelledby="daily-backups-heading">
    <div className="panel-heading"><h2 id="daily-backups-heading">Daily backups</h2><Button ref={refreshButton} pending={state.kind === "loading"} onClick={() => {
      restoreRefreshFocus.current = document.activeElement === refreshButton.current;
      void load();
    }}>Refresh status</Button></div>
    {state.kind === "loading" && <Notice>Loading backup status…</Notice>}
    {state.kind === "error" && <Notice tone="error">Could not load backup status. Check your connection and refresh.</Notice>}
    {state.kind === "denied" && <Notice tone="error">Instance administrator access is required.</Notice>}
    {status?.kind === "unavailable" && <Notice tone="warning">Backup status is unavailable or out of date. Ask the host operator to check the managed app process, storage permissions, and host logs. Refresh after recovery.</Notice>}
    {status?.kind === "available" && <>
      <Badge>{status.running ? "Backup in progress" : "Scheduler active"}</Badge>
      {!status.lastSuccess && <Notice tone="warning">No validated daily snapshot is recorded. Check host logs and backup storage before relying on recovery.</Notice>}
      {status.lastFailure && <Notice tone={status.lastCheck === "succeeded" ? "info" : "warning"}>{status.lastCheck === "succeeded" ? "A previous backup check failed. The latest check succeeded." : "The last backup check failed. The scheduler retries after five minutes. Ask the host operator to check storage, free space, and operations leases in host logs."}</Notice>}
      <dl className="backup-facts"><div><dt>Last validated daily snapshot</dt><dd>{timestamp(status.lastSuccess)}</dd></div>
        <div><dt>Last failed check</dt><dd>{timestamp(status.lastFailure)}</dd></div><div><dt>Next scheduled check</dt><dd>{timestamp(status.nextRun)}</dd></div><div><dt>Status checked</dt><dd>{timestamp(status.checkedAt)}</dd></div></dl>
    </>}
    <p className="hint">The scheduler checks once per minute, runs daily at 00:00 UTC, and catches up at startup. Refresh to see a new check. Fourteen validated daily snapshots are retained.</p>
  </section><section className="panel setting-panel"><h2>Protect recovery copies</h2><p>Snapshots contain credentials and financial records for the entire instance. Instance administration does not grant access to other people’s sheets.</p>
    <p>Ask the host operator to export a validated snapshot, encrypt it, and copy it to a separate protected host. Keep the auth secret in protected operator storage. Separate volumes on this host cannot protect against host loss.</p>
    <p>Backup export and restore use host commands. Follow the repository’s backup runbook. Stop every app process before restoring or recovering stale leases; verify a fresh-volume restore before replacing a working instance.</p></section></>;
}
