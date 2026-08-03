const normalizeCellText = (cell: HTMLTableCellElement): string =>
  (cell.textContent ?? "").replace(/\s+/g, " ").trim();

const tableRows = (
  table: HTMLTableElement,
): ReadonlyArray<ReadonlyArray<string>> =>
  Array.from(table.rows, (row) =>
    Array.from(row.cells, (cell) => normalizeCellText(cell)),
  ).filter((row) => row.length > 0);

const escapeMarkdownCell = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");

const escapeCsvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export const serializeTableToMarkdown = (table: HTMLTableElement): string => {
  const rows = tableRows(table);
  const header = rows[0];
  if (header === undefined) {
    return "";
  }

  const markdownRows = rows.map(
    (row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`,
  );
  markdownRows.splice(1, 0, `| ${header.map(() => "---").join(" | ")} |`);
  return markdownRows.join("\n");
};

export const serializeTableToCsv = (table: HTMLTableElement): string =>
  tableRows(table)
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n");
