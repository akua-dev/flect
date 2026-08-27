import { useEffect, useRef, useState } from 'react';
import type { ShareInstallationRecord } from '../../shared/share-installation';

export interface ShareLibraryProps {
	readonly open: boolean;
	readonly entries: ReadonlyArray<ShareInstallationRecord>;
	readonly onClose: () => void;
	readonly onExport: (shareId: string) => Promise<void>;
	readonly onRemove: (shareId: string) => Promise<void>;
	readonly onDelete: (shareId: string, expectedForkCommit: string) => Promise<void>;
}

interface Confirmation {
	readonly action: 'remove' | 'delete';
	readonly shareId: string;
}

const sourceLabel = (entry: ShareInstallationRecord) => {
	switch (entry.source._tag) {
		case 'local':
			return 'Local shared file';
		case 'url':
			return 'Shared file URL';
		case 'git':
			return 'Public Git revision';
		case 'private':
			return `Private source · ${entry.source.adapterId}`;
	}
};

export function ShareLibrary({
	open,
	entries,
	onClose,
	onExport,
	onRemove,
	onDelete
}: ShareLibraryProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const openerRef = useRef<{ focus: (options?: FocusOptions) => void } | undefined>(undefined);
	const [confirmation, setConfirmation] = useState<Confirmation>();
	const [busyShareId, setBusyShareId] = useState<string>();
	const [error, setError] = useState<string>();

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!open || dialog === null) return;
		const active = document.activeElement;
		const focus = active !== null && 'focus' in active ? active.focus : undefined;
		openerRef.current =
			active !== null && typeof focus === 'function'
				? {
						focus: (options) => {
							Reflect.apply(focus, active, [options]);
						}
					}
				: undefined;
		if (!dialog.open) {
			if (typeof dialog.showModal === 'function') dialog.showModal();
			else dialog.setAttribute('open', '');
		}
		queueMicrotask(() =>
			dialog.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true })
		);
		return () => {
			if (dialog.open) {
				if (typeof dialog.close === 'function') dialog.close();
				else dialog.removeAttribute('open');
			}
			openerRef.current?.focus({ preventScroll: true });
		};
	}, [open]);

	useEffect(() => {
		if (!open) {
			setConfirmation(undefined);
			setError(undefined);
		}
	}, [open]);

	if (!open) return null;

	const run = async (shareId: string, operation: () => Promise<void>) => {
		setBusyShareId(shareId);
		setError(undefined);
		try {
			await operation();
			setConfirmation(undefined);
		} catch {
			setError('That shared-source operation could not be completed safely.');
		} finally {
			setBusyShareId(undefined);
		}
	};

	return (
		<dialog
			aria-labelledby='share-library-title'
			className='share-library'
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			ref={dialogRef}
		>
			<header className='share-library__header'>
				<div>
					<p>Portable sources</p>
					<h2 id='share-library-title'>Shared sources</h2>
				</div>
				<button
					aria-label='Close shared sources'
					className='share-library__close'
					onClick={onClose}
					type='button'
				>
					Close
				</button>
			</header>

			<p className='share-library__intro'>
				Each source keeps its own guarded Git fork. Removing it from this app does not delete your
				history.
			</p>

			{error !== undefined && (
				<p className='share-library__error' role='alert'>
					{error}
				</p>
			)}

			{entries.length === 0 ? (
				<div className='share-library__empty'>
					<strong>No shared sources yet</strong>
					<span>Open a .flect-share file, URL, or public Git revision.</span>
				</div>
			) : (
				<ul className='share-library__list'>
					{entries.map((entry) => {
						const installed = entry.installedArtifactIds.length > 0;
						const confirming = confirmation?.shareId === entry.shareId;
						const busy = busyShareId === entry.shareId;
						return (
							<li className='share-library__item' key={entry.shareId}>
								<div className='share-library__summary'>
									<div>
										<strong>{entry.manifest?.name ?? entry.shareId}</strong>
										<code>{entry.shareId}</code>
									</div>
									<span data-installed={installed}>
										{installed
											? `${entry.installedArtifactIds.length} ${entry.installedArtifactIds.length === 1 ? 'part' : 'parts'} in app`
											: 'Kept locally'}
									</span>
								</div>
								<dl className='share-library__facts'>
									<div>
										<dt>Version</dt>
										<dd>{entry.version}</dd>
									</div>
									<div>
										<dt>Source</dt>
										<dd>{sourceLabel(entry)}</dd>
									</div>
									<div>
										<dt>Fork</dt>
										<dd title={entry.refs.fork}>{entry.refs.fork.slice(0, 10)}</dd>
									</div>
								</dl>

								{confirming ? (
									<fieldset className='share-library__confirmation'>
										<legend className='sr-only'>
											Confirm {confirmation.action} {entry.shareId}
										</legend>
										<p>
											{confirmation.action === 'remove'
												? 'Remove its active parts from this app? The fork and export remain available.'
												: 'Permanently delete this local fork and retained archive? Browser deletion cannot be undone.'}
										</p>
										{confirmation.action === 'delete' && (
											<code>
												{entry.shareId} · flect/shared/…/fork · {entry.refs.fork}
											</code>
										)}
										<div>
											<button
												className='decision-button decision-button--danger'
												disabled={busy}
												onClick={() =>
													void run(entry.shareId, () =>
														confirmation.action === 'remove'
															? onRemove(entry.shareId)
															: onDelete(entry.shareId, entry.refs.fork)
													)
												}
												type='button'
												aria-label={`Confirm ${confirmation.action} ${entry.shareId}`}
											>
												{busy
													? 'Working…'
													: confirmation.action === 'remove'
														? 'Remove from app'
														: 'Delete local data'}
											</button>
											<button
												className='decision-button'
												disabled={busy}
												onClick={() => setConfirmation(undefined)}
												type='button'
											>
												Cancel
											</button>
										</div>
									</fieldset>
								) : (
									<div className='share-library__actions'>
										<button
											className='decision-button'
											disabled={busy}
											onClick={() => void run(entry.shareId, () => onExport(entry.shareId))}
											type='button'
										>
											Export fork
										</button>
										<button
											aria-label={
												installed
													? `Remove ${entry.shareId} from app`
													: `Delete local data for ${entry.shareId}`
											}
											className='decision-button'
											disabled={busy}
											onClick={() =>
												setConfirmation({
													action: installed ? 'remove' : 'delete',
													shareId: entry.shareId
												})
											}
											type='button'
										>
											{installed ? 'Remove from app' : 'Delete local data'}
										</button>
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
			<p className='share-library__footnote'>
				Unreachable Git objects may remain until bounded local maintenance.
			</p>
		</dialog>
	);
}
