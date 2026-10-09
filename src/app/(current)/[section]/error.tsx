"use client";
export default function SheetLoadError({ reset }: { reset: () => void }) {
  return <main className="sheet-page"><section className="sheet-panel"><h1>Could not load the sheet</h1>
    <p role="alert">Try loading it again.</p><button className="button secondary" onClick={reset}>Retry</button></section></main>;
}
