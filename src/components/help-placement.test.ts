import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("attaches every contextual help trigger to its text or a sibling field label", () => {
  const directory = path.join(process.cwd(), "src/components");
  const detached: string[] = [];
  for (const name of readdirSync(directory).filter(name => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))) {
    const source = ts.createSourceFile(name, readFileSync(path.join(directory, name), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function inspect(node: ts.Node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "Help") {
        const hasText = node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "text");
        const parent = node.parent;
        const fieldLabel = ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent) && parent.parent.name.getText(source) === "labelHelp";
        const inlineParent = ts.isJsxElement(parent) && parent.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className" && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text.split(/\s+/).includes("help-label"));
        if (!hasText && !fieldLabel && !inlineParent) detached.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  expect(detached, "Help must share an inline label parent, use labelHelp, or provide its own visible text").toEqual([]);
});
