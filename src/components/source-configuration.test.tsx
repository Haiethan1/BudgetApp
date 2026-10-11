import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceConfiguration } from "./source-configuration";
import { Field } from "./ui";

function render(mode: Parameters<typeof SourceConfiguration>[0]["mode"], pending = false) {
  return renderToStaticMarkup(<SourceConfiguration mode={mode} pending={pending} name="My card" onEdit={() => undefined} onInspect={() => undefined}><Field id="date-column" label="Date column" defaultValue="Date" /></SourceConfiguration>);
}
it("hides saved settings by default and requires the explicit Edit source action", () => {
  const collapsed = render("collapsed");
  expect(collapsed).toContain("Edit source");
  expect(collapsed).toContain("View source settings");
  expect(collapsed).not.toContain("date-column");
  const inspected = render("locked");
  expect(inspected).toContain('<fieldset class="editor-fields" disabled="">');
  expect(inspected).toContain("date-column");
  expect(inspected).toContain("Edit source");
});
it("allows explicit new mapping and saved-profile editing, and disables both while saving", () => {
  for (const mode of ["new", "editing"] satisfies Parameters<typeof SourceConfiguration>[0]["mode"][]) {
    expect(render(mode)).toContain('<fieldset class="editor-fields">');
    expect(render(mode)).toContain("date-column");
    expect(render(mode, true)).toContain('<fieldset class="editor-fields" disabled="">');
  }
});
