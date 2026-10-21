"use client";
import { usePathname } from "next/navigation";
import { Panel } from "./ui";

export function PageSkeleton() {
  const section = usePathname().split("/")[1];
  const summary = section === "overview" || section === "budgets";
  return <div className={`page-skeleton page-skeleton-${section}`} role="status" aria-busy="true"><span className="sr-only">Preparing page</span>
    {summary && <div className="summary-grid">{Array.from({ length: 3 }, (_, index) => <Panel key={index}><div className="skeleton skeleton-label" /><div className="skeleton skeleton-value" /><div className="skeleton skeleton-caption" /></Panel>)}</div>}
    {section === "overview" ? <>
      <div className="overview-grid"><SkeletonRows count={3} /><SkeletonRows count={3} /></div>
      <SkeletonRows count={5} records />
    </> : <>
      {(section === "transactions" || section === "owed") && <Panel><div className="skeleton-filter-grid">{Array.from({ length: section === "owed" ? 2 : 3 }, (_, index) => <div key={index} className="skeleton skeleton-row" />)}</div></Panel>}
      <SkeletonRows count={section === "import" ? 2 : 5} records={section === "transactions"} />
    </>}
  </div>;
}

function SkeletonRows({ count, records = false }: { count: number; records?: boolean }) {
  return <Panel><div className="skeleton skeleton-label" /><div className={records ? "skeleton-records" : undefined} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => records ? <div key={index} className="skeleton-record">{Array.from({ length: 6 }, (_, column) => <div key={column} className="skeleton" />)}</div> : <div key={index} className="skeleton skeleton-row" />)}
  </div></Panel>;
}
