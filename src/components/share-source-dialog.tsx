import { Effect, Schema } from 'effect';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { PrivateShareSourceSummary } from '../../packages/product/src/host/share-source';
import {
	ShareGitSource,
	SharePrivateSource,
	ShareUrlSource
} from '../../packages/product/src/share';

export interface ShareSourceDialogProps {
	readonly open: boolean;
	readonly candidateOpen?: boolean;
	readonly privateSources?: ReadonlyArray<PrivateShareSourceSummary>;
	readonly onClose: () => void;
	readonly onOpenUrl: (url: string) => Promise<void>;
	readonly onOpenGit: (url: string, commit: string) => Promise<void>;
	readonly onOpenPrivate?: (adapterId: string, reference: string) => Promise<void>;
}

const isFocusable = (
	element: Element | null
): element is Element & { readonly isConnected: boolean; focus: () => void } =>
	element !== null && 'focus' in element && typeof element.focus === 'function';

export function ShareSourceDialog({
	open,
	candidateOpen = false,
	privateSources = [],
	onClose,
	onOpenUrl,
	onOpenGit,
	onOpenPrivate
}: ShareSourceDialogProps) {
	const [mode, setMode] = useState<'url' | 'git' | 'private'>('url');
	const [url, setUrl] = useState('');
	const [commit, setCommit] = useState('');
	const [privateReference, setPrivateReference] = useState('');
	const [privateAdapterId, setPrivateAdapterId] = useState(privateSources[0]?.id ?? '');
	const [replaceConfirmed, setReplaceConfirmed] = useState(false);
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const urlRef = useRef<HTMLInputElement>(null);
	const returnFocusRef = useRef<
		Element & {
			readonly isConnected: boolean;
			focus: () => void;
		}
	>(null);
	const errorId = useId();
	const panelId = useId();
	const privateAvailable = privateSources.length > 0 && onOpenPrivate !== undefined;

	const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
		if (
			event.key !== 'ArrowLeft' &&
			event.key !== 'ArrowRight' &&
			event.key !== 'Home' &&
			event.key !== 'End'
		) {
			return;
		}
		const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')];
		if (!(event.target instanceof HTMLButtonElement)) return;
		const current = tabs.indexOf(event.target);
		if (current < 0 || tabs.length === 0) return;
		event.preventDefault();
		const index =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? tabs.length - 1
					: event.key === 'ArrowRight'
						? (current + 1) % tabs.length
						: (current - 1 + tabs.length) % tabs.length;
		const next = tabs[index];
		const nextMode = next?.dataset.shareSourceMode;
		if (
			next === undefined ||
			(nextMode !== 'url' && nextMode !== 'git' && nextMode !== 'private')
		) {
			return;
		}
		setMode(nextMode);
		setError(undefined);
		next.focus();
	};

	useEffect(() => {
		const dialog = dialogRef.current;
		if (dialog === null) return;
		if (open && !dialog.open) {
			setReplaceConfirmed(false);
			if (isFocusable(document.activeElement)) {
				returnFocusRef.current = document.activeElement;
			}
			if (typeof dialog.showModal === 'function') dialog.showModal();
			else dialog.setAttribute('open', '');
			queueMicrotask(() => urlRef.current?.focus());
		} else if (!open && dialog.open) {
			if (typeof dialog.close === 'function') dialog.close();
			else dialog.removeAttribute('open');
			const returnFocus = returnFocusRef.current;
			returnFocusRef.current = null;
			if (returnFocus?.isConnected) queueMicrotask(() => returnFocus.focus());
		}
	}, [open]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const decoded =
			mode === 'url'
				? Effect.runSync(
						Effect.result(Schema.decodeUnknownEffect(ShareUrlSource)({ _tag: 'url', url }))
					)
				: mode === 'git'
					? Effect.runSync(
							Effect.result(
								Schema.decodeUnknownEffect(ShareGitSource)({
									_tag: 'git',
									url,
									commit
								})
							)
						)
					: Effect.runSync(
							Effect.result(
								Schema.decodeUnknownEffect(SharePrivateSource)({
									_tag: 'private',
									adapterId: privateAdapterId,
									reference: privateReference
								})
							)
						);
		if (decoded._tag === 'Failure') {
			setError(
				mode === 'url'
					? 'Enter an HTTPS URL without credentials.'
					: mode === 'git'
						? 'Enter a public HTTPS URL and a 40-character commit.'
						: 'Choose a private source and enter its opaque reference.'
			);
			return;
		}
		setError(undefined);
		setBusy(true);
		try {
			if (mode === 'url') await onOpenUrl(url);
			else if (mode === 'git') await onOpenGit(url, commit);
			else if (onOpenPrivate !== undefined) {
				await onOpenPrivate(privateAdapterId, privateReference);
			}
			onClose();
		} catch {
			setError('The shared source could not be opened. Check it and try again.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<dialog
			aria-labelledby='share-source-title'
			className='share-source-dialog'
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			ref={dialogRef}
		>
			<form onSubmit={(event) => void submit(event)}>
				<header>
					<div>
						<h2 id='share-source-title'>Review a shared source</h2>
						<p className='share-source-dialog__description'>
							Content stays inactive until you review and keep it.
						</p>
					</div>
					<button aria-label='Close shared source dialog' onClick={onClose} type='button'>
						Close
					</button>
				</header>

				<div
					aria-label='Source type'
					className='share-source-dialog__tabs'
					onKeyDown={moveTab}
					role='tablist'
				>
					<button
						aria-controls={panelId}
						aria-selected={mode === 'url'}
						data-share-source-mode='url'
						onClick={() => {
							setMode('url');
							setError(undefined);
						}}
						role='tab'
						tabIndex={mode === 'url' ? 0 : -1}
						type='button'
					>
						Shared file
					</button>
					<button
						aria-controls={panelId}
						aria-selected={mode === 'git'}
						data-share-source-mode='git'
						onClick={() => {
							setMode('git');
							setError(undefined);
						}}
						role='tab'
						tabIndex={mode === 'git' ? 0 : -1}
						type='button'
					>
						Public Git
					</button>
					{privateAvailable && (
						<button
							aria-controls={panelId}
							aria-selected={mode === 'private'}
							data-share-source-mode='private'
							onClick={() => {
								setMode('private');
								setError(undefined);
								if (privateAdapterId === '') {
									setPrivateAdapterId(privateSources[0]?.id ?? '');
								}
							}}
							role='tab'
							tabIndex={mode === 'private' ? 0 : -1}
							type='button'
						>
							Private source
						</button>
					)}
				</div>

				<div aria-live='polite' id={panelId} role='tabpanel'>
					{mode !== 'private' && (
						<label>
							<span>{mode === 'url' ? 'Shared file URL' : 'Repository URL'}</span>
							<input
								aria-describedby={error === undefined ? undefined : errorId}
								aria-invalid={error !== undefined}
								autoComplete='off'
								disabled={busy}
								name='share-source-url'
								onChange={(event) => setUrl(event.currentTarget.value)}
								ref={urlRef}
								type='url'
								value={url}
							/>
						</label>
					)}
					{mode === 'git' && (
						<label>
							<span>Exact commit</span>
							<input
								aria-describedby={error === undefined ? undefined : errorId}
								aria-invalid={error !== undefined}
								autoComplete='off'
								disabled={busy}
								maxLength={40}
								name='share-source-commit'
								onChange={(event) => setCommit(event.currentTarget.value)}
								spellCheck={false}
								value={commit}
							/>
						</label>
					)}
					{mode === 'private' && privateAvailable && (
						<>
							<label>
								<span>Private source</span>
								<select
									disabled={busy}
									name='share-source-adapter'
									onChange={(event) => setPrivateAdapterId(event.currentTarget.value)}
									value={privateAdapterId}
								>
									{privateSources.map((source) => (
										<option key={source.id} value={source.id}>
											{source.name}
										</option>
									))}
								</select>
							</label>
							<label>
								<span>Private reference</span>
								<input
									aria-describedby={error === undefined ? undefined : errorId}
									aria-invalid={error !== undefined}
									autoComplete='off'
									disabled={busy}
									name='share-source-reference'
									onChange={(event) => setPrivateReference(event.currentTarget.value)}
									ref={urlRef}
									type='text'
									value={privateReference}
								/>
							</label>
						</>
					)}
				</div>
				{error !== undefined && (
					<p id={errorId} role='alert'>
						{error}
					</p>
				)}
				{candidateOpen && (
					<label className='share-source-dialog__replacement'>
						<input
							checked={replaceConfirmed}
							disabled={busy}
							name='replace-share-candidate'
							onChange={(event) => setReplaceConfirmed(event.currentTarget.checked)}
							type='checkbox'
						/>
						<span>Replace the inactive candidate. Your accepted app stays unchanged.</span>
					</label>
				)}
				<footer>
					<button className='decision-button' onClick={onClose} type='button'>
						Cancel
					</button>
					<button
						className='decision-button decision-button--primary'
						disabled={busy || (candidateOpen && !replaceConfirmed)}
						type='submit'
					>
						{busy ? 'Opening…' : 'Review source'}
					</button>
				</footer>
			</form>
		</dialog>
	);
}
