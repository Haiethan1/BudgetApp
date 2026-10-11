import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewPageWindow } from "../imports/review-pagination";
import { ImportReviewPagination } from "./import-review-pagination";

function render(page = 1, disabled = false, total = 101) {
  const window = reviewPageWindow({ total, page, pageSize: 50 });
  return renderToStaticMarkup(<>{["top", "bottom"].map((position) => <ImportReviewPagination key={position} position={position === "top" ? "top" : "bottom"} window={window} pageSize={50} disabled={disabled} onPage={() => undefined} onPageSize={() => undefined} />)}</>);
}
it("offers matching top and bottom ranges and labeled page-size choices", () => {
  const html = render();
  expect(html.match(/1–50 of 101 source rows/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Review pagination, top"');
  expect(html).toContain('aria-label="Review pagination, bottom"');
  expect(html).toContain('id="review-page-size-top"');
  expect(html).toContain('id="review-page-size-bottom"');
  expect(html.match(/<option value="50" selected="">50<\/option>/g)).toHaveLength(2);
  expect(html.match(/<option value="25">25<\/option>/g)).toHaveLength(2);
  expect(html.match(/<option value="100">100<\/option>/g)).toHaveLength(2);
});
it("disables boundary navigation and every pagination control during mutations", () => {
  expect(render()).toContain('data-review-direction="previous" type="button" class="button secondary " disabled=""');
  expect(render(3)).toContain('data-review-direction="next" type="button" class="button secondary " disabled=""');
  expect(render(3)).toContain('101–101 of 101 source rows');
  expect(render(2, true).match(/disabled=""/g)).toHaveLength(6);
  expect(render(1, false, 0)).toContain('0–0 of 0 source rows');
});
