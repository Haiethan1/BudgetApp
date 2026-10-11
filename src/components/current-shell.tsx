"use client";
import { createContext, useContext, useLayoutEffect, useState, type ComponentProps, type ReactNode } from "react";
import { AppShell } from "./app-shell";

export type ShellSnapshot = Omit<ComponentProps<typeof AppShell>, "children">;
const SnapshotContext = createContext<((snapshot: ShellSnapshot) => void) | null>(null);

export function CurrentShell({ initial, children }: { initial: ShellSnapshot; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial);
  return <SnapshotContext.Provider value={setSnapshot}><AppShell {...snapshot} key={snapshot.sheet?.id}>{children}</AppShell></SnapshotContext.Provider>;
}

// Layouts are cached by the router. Each completed page supplies its freshly
// authorized identity before paint, including after another tab selects a sheet.
export function CurrentPage({ snapshot, children }: { snapshot: ShellSnapshot; children: ReactNode }) {
  const update = useContext(SnapshotContext);
  useLayoutEffect(() => { update?.(snapshot); }, [snapshot, update]);
  return children;
}
