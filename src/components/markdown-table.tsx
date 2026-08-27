import { Effect, Exit } from 'effect';
import { type ComponentProps, type ReactElement, useEffect, useRef, useState } from 'react';
import { Clipboard } from '../lib/clipboard';
import { browserRuntime } from '../lib/runtime';
import { CollapseIcon, CopyIcon, ExpandIcon } from './icons';
import { serializeTableToCsv, serializeTableToMarkdown } from './markdown-table-serialization';

type CopyFormat = 'markdown' | 'csv';
type CopyState = 'idle' | 'copied' | 'failed';

type MarkdownTableProps = ComponentProps<'table'> & {
	readonly node?: unknown;
};

const copyTable = Effect.fn('Flect.Markdown.copyTable')(function* (value: string) {
	const clipboard = yield* Clipboard;
	yield* clipboard.writeText(value);
});

export function MarkdownTable({
	children,
	node: _node,
	...props
}: MarkdownTableProps): ReactElement {
	const tableRef = useRef<HTMLTableElement>(null);
	const acknowledgementTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const [expanded, setExpanded] = useState(false);
	const [copyState, setCopyState] = useState<CopyState>('idle');
	const [copyFormat, setCopyFormat] = useState<CopyFormat>('markdown');

	useEffect(
		() => () => {
			if (acknowledgementTimer.current !== undefined) {
				clearTimeout(acknowledgementTimer.current);
			}
		},
		[]
	);

	const acknowledge = (state: Exclude<CopyState, 'idle'>, format: CopyFormat) => {
		if (acknowledgementTimer.current !== undefined) {
			clearTimeout(acknowledgementTimer.current);
		}
		setCopyFormat(format);
		setCopyState(state);
		acknowledgementTimer.current = setTimeout(() => {
			acknowledgementTimer.current = undefined;
			setCopyState('idle');
		}, 1_200);
	};

	const handleCopy = (format: CopyFormat) => {
		const table = tableRef.current;
		if (table === null) {
			return;
		}
		const value =
			format === 'markdown' ? serializeTableToMarkdown(table) : serializeTableToCsv(table);
		void browserRuntime.runPromiseExit(copyTable(value)).then((exit) => {
			acknowledge(Exit.isSuccess(exit) ? 'copied' : 'failed', format);
		});
	};

	const expansionLabel = expanded ? 'Collapse table cells' : 'Expand table cells';
	const status =
		copyState === 'failed'
			? 'Copy failed'
			: copyState === 'copied'
				? `Copied ${copyFormat === 'markdown' ? 'Markdown' : 'CSV'}`
				: '';

	return (
		<figure className='markdown-table' data-expanded={expanded ? 'true' : 'false'}>
			<div className='markdown-table__viewport'>
				<table {...props} ref={tableRef}>
					{children}
				</table>
			</div>
			<figcaption className='markdown-table__footer'>
				<button
					aria-label={expansionLabel}
					aria-pressed={expanded}
					className='markdown-action'
					onClick={() => setExpanded((value) => !value)}
					type='button'
				>
					{expanded ? <CollapseIcon /> : <ExpandIcon />}
				</button>
				<span className='markdown-table__copy-actions'>
					<button
						aria-label='Copy table as Markdown'
						className='markdown-action markdown-action--labeled'
						onClick={() => handleCopy('markdown')}
						type='button'
					>
						<CopyIcon />
						Markdown
					</button>
					<button
						aria-label='Copy table as CSV'
						className='markdown-action markdown-action--labeled'
						onClick={() => handleCopy('csv')}
						type='button'
					>
						<CopyIcon />
						CSV
					</button>
				</span>
				<span aria-live='polite' className='sr-only' role='status'>
					{status}
				</span>
			</figcaption>
		</figure>
	);
}
