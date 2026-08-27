import { Effect, Exit } from 'effect';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Clipboard } from '../lib/clipboard';
import { browserRuntime } from '../lib/runtime';
import { CheckIcon, CopyIcon, WrapIcon } from './icons';
import { highlightMarkdownCode } from './markdown-highlighter';

export interface MarkdownCodeBlockProps {
	readonly code: string;
	readonly language: string;
	readonly title?: string;
	readonly streaming: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

const copyCode = Effect.fn('Flect.Markdown.copyCode')(function* (code: string) {
	const clipboard = yield* Clipboard;
	yield* clipboard.writeText(code);
});

export function MarkdownCodeBlock({
	code,
	language,
	title,
	streaming
}: MarkdownCodeBlockProps): ReactElement {
	const [highlightedHtml, setHighlightedHtml] = useState<string>();
	const [wrapped, setWrapped] = useState(false);
	const [copyState, setCopyState] = useState<CopyState>('idle');
	const acknowledgementTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		setHighlightedHtml(undefined);
		if (streaming) {
			return;
		}

		return Effect.runCallback(highlightMarkdownCode(code, language), {
			onExit: (exit) => {
				if (Exit.isSuccess(exit)) {
					setHighlightedHtml(exit.value);
				}
			}
		});
	}, [code, language, streaming]);

	useEffect(
		() => () => {
			if (acknowledgementTimer.current !== undefined) {
				clearTimeout(acknowledgementTimer.current);
			}
		},
		[]
	);

	const acknowledge = (state: Exclude<CopyState, 'idle'>) => {
		if (acknowledgementTimer.current !== undefined) {
			clearTimeout(acknowledgementTimer.current);
		}
		setCopyState(state);
		acknowledgementTimer.current = setTimeout(() => {
			acknowledgementTimer.current = undefined;
			setCopyState('idle');
		}, 1_200);
	};

	const handleCopy = () => {
		void browserRuntime.runPromiseExit(copyCode(code)).then((exit) => {
			acknowledge(Exit.isSuccess(exit) ? 'copied' : 'failed');
		});
	};

	const wrapLabel = wrapped ? 'Disable line wrap' : 'Wrap lines';
	const copyLabel =
		copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy code';

	return (
		<figure className='markdown-code' data-language={language}>
			<figcaption className='markdown-code__header'>
				<span className='markdown-code__title' title={title ?? language}>
					{title ?? language}
				</span>
				<span className='markdown-code__actions'>
					<button
						aria-label={wrapLabel}
						aria-pressed={wrapped}
						className='markdown-action'
						onClick={() => setWrapped((value) => !value)}
						type='button'
					>
						<WrapIcon />
					</button>
					<button
						aria-label={copyLabel}
						className='markdown-action'
						onClick={handleCopy}
						type='button'
					>
						{copyState === 'copied' ? <CheckIcon /> : <CopyIcon />}
					</button>
				</span>
				<span aria-live='polite' className='sr-only' role='status'>
					{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : ''}
				</span>
			</figcaption>
			<div className='markdown-code__viewport' data-wrap={wrapped ? 'true' : 'false'}>
				{highlightedHtml === undefined ? (
					<pre>
						<code>{code}</code>
					</pre>
				) : (
					<div
						className='markdown-code__highlight'
						// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki is pinned, receives plain code, and is the only trusted HTML producer.
						dangerouslySetInnerHTML={{ __html: highlightedHtml }}
					/>
				)}
			</div>
		</figure>
	);
}
