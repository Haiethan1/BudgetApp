"use client";
import Link from "next/link";
import { useState, type ComponentProps } from "react";

export function IntentLink(props: Omit<ComponentProps<typeof Link>, "prefetch" | "onMouseEnter" | "onFocus">) {
  const [prefetch, setPrefetch] = useState(false);
  return <Link {...props} prefetch={prefetch} onMouseEnter={() => setPrefetch(true)} onFocus={() => setPrefetch(true)} />;
}
