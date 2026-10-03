"use client";
import { ErrorState } from "@/components/ui";
export default function Error({ reset }: { reset: () => void }) { return <main className="sheet-page"><ErrorState retry={reset}>Could not load this sheet. Try again.</ErrorState></main>; }
