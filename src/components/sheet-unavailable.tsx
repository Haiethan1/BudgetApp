"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { EmptyState } from "./ui";
import { SessionWatch } from "./session-watch";
export function SheetUnavailable() {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  return <main className="sheet-page"><h1 ref={title} tabIndex={-1}>This sheet is no longer available</h1><EmptyState title="Choose where to continue" action={<><Link href="/" prefetch={false}>Choose another sheet</Link><Link href="/sheets/new" prefetch={false}>Create sheet</Link></>}>Choose another sheet or create one to continue.</EmptyState><SessionWatch /></main>;
}
