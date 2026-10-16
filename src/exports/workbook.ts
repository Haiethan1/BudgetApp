import { deflateRawSync } from "node:zlib";

export type Cell = string | number | boolean | null;
export type Tab = { name: string; headers: string[]; rows: Cell[][] };

function xml(value: string) {
  return value.replace(/_x[0-9a-fA-F]{4}_/g, match => `_x005F_${match.slice(1)}`)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, match => `_x${match.charCodeAt(0).toString(16).padStart(4, "0")}_`)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;");
}
function column(index: number): string {
  let result = "";
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
function worksheet(tab: Tab) {
  if (tab.rows.length > 1048575 || tab.headers.length > 16384) throw new Error("This export exceeds Excel's worksheet limit. Choose a smaller date range.");
  const sizes = tab.headers.map((header, i) => Math.min(48, Math.max(header.includes("ID") ? 38 : 18, header.length + 3, ...tab.rows.slice(0, 200).map(row => typeof row[i] === "string" ? Math.min(48, row[i].length + 2) : 0))));
  const rows = [tab.headers, ...tab.rows].map((row, r) => {
    const lines = Math.max(1, ...row.map((value, i) => typeof value === "string" ? value.split(/\r\n|\r|\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.replace(/\t/g, "    ").length / Math.max(1, (sizes[i] ?? 18) - 2))), 0) : 1));
    return `<row r="${r + 1}" ht="${Math.min(409, lines * 16 + 4)}" customHeight="1">${row.map((value, c) => {
    if (value === null) return "";
    const ref = `${column(c)}${r + 1}`;
    if (typeof value === "number") return `<c r="${ref}" s="2"><v>${value}</v></c>`;
    if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${Number(value)}</v></c>`;
    if (value.length > 32767) throw new Error("A text value exceeds Excel's cell limit. Shorten the source text before exporting.");
    return `<c r="${ref}" t="inlineStr" s="${r === 0 ? 1 : 0}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join("")}</row>`;
  }).join("");
  const end = `${column(tab.headers.length - 1)}${tab.rows.length + 1}`;
  const widths = sizes.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${end}"/></worksheet>`;
}
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; content: string }[]) {
  const parts: Buffer[] = [], directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), raw = Buffer.from(file.content), compressed = deflateRawSync(raw), crc = crc32(raw);
    if (raw.length > 0xffffffff || compressed.length > 0xffffffff || offset + 30 + name.length + compressed.length > 0xffffffff) throw new Error("This export exceeds the workbook size limit. Choose a smaller date range.");
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    parts.push(local, name, compressed); directory.push(central, name); offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}
export function writeWorkbook(tabs: Tab[]) {
  if (!tabs.length || tabs.length > 65530 || new Set(tabs.map(tab => tab.name.toLowerCase())).size !== tabs.length || tabs.some(tab => !tab.name || tab.name.length > 31 || /[\\/?*\[\]:]/.test(tab.name) || !tab.headers.length)) throw new Error("Invalid workbook tabs.");
  const ns = "http://schemas.openxmlformats.org";
  return zip([
    { name: "[Content_Types].xml", content: `<?xml version="1.0"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tabs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${tabs.map((tab, i) => `<sheet name="${xml(tab.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0"?><Relationships xmlns="${ns}/package/2006/relationships">${tabs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: `<?xml version="1.0"?><styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF214D43"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...tabs.map((tab, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: worksheet(tab) })),
  ]);
}
