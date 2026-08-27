// @vitest-environment jsdom

import { describe, expect, it } from '@effect/vitest';
import { serializeTableToCsv, serializeTableToMarkdown } from './markdown-table-serialization';

const makeTable = (markup: string) => {
	const host = document.createElement('div');
	host.innerHTML = markup;
	const table = host.querySelector('table');
	if (table === null) {
		throw new Error('Fixture must contain a table');
	}
	return table;
};

describe('Markdown table serialization', () => {
	it('escapes Markdown pipes and emits a separator', () => {
		const table = makeTable(`
      <table>
        <thead><tr><th>Name</th><th>Note</th></tr></thead>
        <tbody><tr><td>Flect</td><td>A | B</td></tr></tbody>
      </table>
    `);

		expect(serializeTableToMarkdown(table)).toBe(
			'| Name | Note |\n| --- | --- |\n| Flect | A \\| B |'
		);
		expect(serializeTableToCsv(table)).toBe('Name,Note\r\nFlect,A | B');
	});

	it('quotes commas, quotes, and newlines in CSV', () => {
		const table = makeTable(`
      <table>
        <tr><th>Name</th><th>Note</th><th>Empty</th></tr>
        <tr><td>Flect</td><td>A, "B"
          and C</td><td></td></tr>
      </table>
    `);

		expect(serializeTableToCsv(table)).toBe('Name,Note,Empty\r\nFlect,"A, ""B"" and C",');
	});

	it('escapes backslashes before Markdown pipes', () => {
		const table = makeTable(`
      <table>
        <tr><th>Value</th></tr>
        <tr><td>C:\\workspace | Flect</td></tr>
      </table>
    `);

		expect(serializeTableToMarkdown(table)).toContain('| C:\\\\workspace \\| Flect |');
	});

	it('supports header-only and empty tables', () => {
		const headerOnly = makeTable('<table><tr><th>Name</th></tr></table>');
		const empty = makeTable('<table></table>');

		expect(serializeTableToMarkdown(headerOnly)).toBe('| Name |\n| --- |');
		expect(serializeTableToCsv(headerOnly)).toBe('Name');
		expect(serializeTableToMarkdown(empty)).toBe('');
		expect(serializeTableToCsv(empty)).toBe('');
	});
});
