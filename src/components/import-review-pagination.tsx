import { reviewPageSizeSchema, reviewPageSizes, type reviewPageWindow, type ReviewPageSize } from "../imports/review-pagination";
import { Button, Selector } from "./ui";

export function ImportReviewPagination({ position, window, pageSize, disabled, onPage, onPageSize, navigationRef }: {
  position: "top" | "bottom"; window: ReturnType<typeof reviewPageWindow>; pageSize: ReviewPageSize; disabled: boolean;
  onPage: (page: number) => void; onPageSize: (size: ReviewPageSize) => void;
  navigationRef?: Ref<HTMLElement>;
}) {
  return <nav ref={navigationRef} tabIndex={-1} className="ledger-pagination import-review-pagination" aria-label={`Review pagination, ${position}`}>
    <span>{window.total === 0 ? 0 : window.start + 1}–{window.end} of {window.total} source rows</span>
    <div className="actions import-actions">
      <Selector id={`review-page-size-${position}`} label="Rows per page" value={pageSize} disabled={disabled} onChange={(event) => onPageSize(reviewPageSizeSchema.parse(Number(event.target.value)))}>{reviewPageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</Selector>
      <Button data-review-direction="previous" disabled={disabled || window.page === 1} onClick={() => onPage(window.page - 1)}>Previous</Button>
      <span className="hint">Page {window.page} of {window.pages}</span>
      <Button data-review-direction="next" disabled={disabled || window.page === window.pages} onClick={() => onPage(window.page + 1)}>Next</Button>
    </div>
  </nav>;
}
import type { Ref } from "react";
