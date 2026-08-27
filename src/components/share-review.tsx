import { useEffect, useMemo, useRef, useState } from 'react';
import type { ShareReview as ShareReviewContract } from '../../shared/share-review';

export interface ShareReviewProps {
	readonly review: ShareReviewContract;
	readonly retained: boolean;
	readonly pending: boolean;
	readonly installedVersion?: string;
	readonly busy?: boolean;
	readonly onRetain: (artifactIds: ReadonlyArray<string>) => Promise<void> | void;
	readonly onPrepareUpdate: () => Promise<void> | void;
	readonly onContinueFork?: () => Promise<void> | void;
	readonly onOpenConflictInShape?: () => Promise<void> | void;
	readonly onActivate: (artifactIds: ReadonlyArray<string>) => Promise<void> | void;
	readonly onReject: () => Promise<void> | void;
	readonly onOpenSource?: () => void;
	readonly onOpenFile?: () => void;
}

const blockerLabel = (blocker: ShareReviewContract['blockers'][number]) =>
	blocker.replaceAll('-', ' ');

const signatureLabel = (status: ShareReviewContract['signature']['status']) =>
	status === 'verified'
		? 'Signature verified'
		: status === 'present-unverified'
			? 'Signature present, not verified'
			: status === 'invalid'
				? 'Invalid signature'
				: 'Unsigned';

const originLabel = (origin: ShareReviewContract['origin']) => {
	switch (origin._tag) {
		case 'local':
			return 'Local shared file';
		case 'url':
			return 'Shared file URL';
		case 'git':
			return 'Public Git revision';
		case 'private':
			return `Private source · ${origin.adapterId}`;
	}
};

const hardBlockers: ReadonlySet<ShareReviewContract['blockers'][number]> = new Set([
	'invalid-signature',
	'incompatible',
	'conflict',
	'migration-review-required'
]);

export function ShareReview({
	review,
	retained,
	pending,
	installedVersion,
	busy = false,
	onRetain,
	onPrepareUpdate,
	onContinueFork,
	onOpenConflictInShape,
	onActivate,
	onReject,
	onOpenSource,
	onOpenFile
}: ShareReviewProps) {
	const allIds = useMemo(() => review.artifacts.map((artifact) => artifact.id), [review.artifacts]);
	const [selected, setSelected] = useState<ReadonlyArray<string>>(allIds);
	const reviewRef = useRef<HTMLElement>(null);
	useEffect(() => {
		setSelected(allIds);
		reviewRef.current?.focus({ preventScroll: true });
	}, [allIds]);
	const blocked =
		!review.compatible ||
		review.lineage === 'conflict' ||
		review.blockers.some((blocker) => hardBlockers.has(blocker));
	const authorityChangeCount = review.changes.filter((change) => change.authorityAffecting).length;
	const alreadyCurrent =
		retained &&
		review.lineage === 'update' &&
		review.version === installedVersion &&
		review.changes.length === 0;
	const primary = alreadyCurrent
		? 'current'
		: review.lineage === 'new'
			? retained
				? 'activate'
				: 'retain'
			: pending
				? 'activate'
				: 'prepare';
	const primaryLabel =
		primary === 'current'
			? 'Already current'
			: primary === 'retain'
				? 'Retain selected'
				: primary === 'prepare'
					? 'Prepare update'
					: 'Preview selected';

	return (
		<section
			aria-labelledby='share-review-title'
			aria-live='polite'
			className='share-review'
			ref={reviewRef}
			tabIndex={-1}
		>
			<header className='share-review__header'>
				<div>
					<p className='share-review__state'>
						{alreadyCurrent ? 'No changes to apply' : 'Inactive until you activate it'}
					</p>
					<h2 id='share-review-title'>{review.name}</h2>
					<p className='share-review__provenance'>
						{review.publisher} · {review.version} · {review.lineage}
					</p>
				</div>
				<span
					className={`share-review__signature share-review__signature--${review.signature.status}`}
				>
					{signatureLabel(review.signature.status)}
				</span>
			</header>

			<p className='share-review__accepted-state'>
				Your accepted app remains available while you inspect this candidate.
			</p>

			<div className='share-review__facts'>
				<div>
					<span>Source</span>
					<strong>{originLabel(review.origin)}</strong>
				</div>
				<div>
					<span>Compatibility</span>
					<strong>
						{review.compatible ? 'Compatible with this Flect' : 'Not compatible with this Flect'}
					</strong>
				</div>
				<div>
					<span>Authority</span>
					<strong>
						{authorityChangeCount} authority-affecting{' '}
						{authorityChangeCount === 1 ? 'change' : 'changes'}
					</strong>
				</div>
			</div>

			<p className='share-review__signature-note'>
				{signatureLabel(review.signature.status)}. A signature identifies a claim; it does not grant
				access or approve capabilities.
			</p>

			{review.blockers.length > 0 && (
				<p className='share-review__warning' role='alert'>
					Review blocked: {review.blockers.map(blockerLabel).join(', ')}.
				</p>
			)}

			<fieldset className='share-review__artifacts' disabled={busy}>
				<legend>Included parts</legend>
				{review.artifacts.map((artifact) => (
					<label key={artifact.id}>
						<input
							checked={selected.includes(artifact.id)}
							onChange={(event) =>
								setSelected((current) =>
									event.currentTarget.checked
										? [...current, artifact.id]
										: current.filter((id) => id !== artifact.id)
								)
							}
							type='checkbox'
						/>
						<span>
							<strong>{artifact.kind}</strong>
							<small>{artifact.sourceRoot}</small>
						</span>
					</label>
				))}
			</fieldset>

			<details className='share-review__changes'>
				<summary>{review.changes.length} reviewed changes</summary>
				<ul>
					{review.changes.map((change) => (
						<li key={`${change.kind}:${change.path}`}>
							<span>
								{change.kind} · {change.category}
								{change.authorityAffecting ? ' · authority' : ''}
							</span>
							<code>{change.path}</code>
						</li>
					))}
				</ul>
			</details>

			<details className='share-review__changes'>
				<summary>Source and lineage details</summary>
				<dl className='share-review__detail-list'>
					<div>
						<dt>Share ID</dt>
						<dd>{review.shareId}</dd>
					</div>
					<div>
						<dt>Lineage</dt>
						<dd>{review.lineage}</dd>
					</div>
					<div>
						<dt>Declared source</dt>
						<dd>{review.source}</dd>
					</div>
					<div>
						<dt>Revision</dt>
						<dd>{review.revision}</dd>
					</div>
					<div>
						<dt>Archive digest</dt>
						<dd>{review.origin.archiveSha256}</dd>
					</div>
					{review.origin._tag === 'git' && (
						<div>
							<dt>Descriptor commit</dt>
							<dd>{review.origin.descriptorCommit}</dd>
						</div>
					)}
					{review.origin._tag === 'private' && (
						<div>
							<dt>Opaque reference digest</dt>
							<dd>{review.origin.referenceSha256}</dd>
						</div>
					)}
				</dl>
			</details>

			{(onOpenSource !== undefined || onOpenFile !== undefined) && (
				<div className='share-review__replace'>
					<span>Review a different source</span>
					<div>
						{onOpenSource !== undefined && (
							<button onClick={onOpenSource} type='button'>
								Open URL or Git
							</button>
						)}
						{onOpenFile !== undefined && (
							<button onClick={onOpenFile} type='button'>
								Open shared file
							</button>
						)}
					</div>
				</div>
			)}

			<div className='share-review__actions'>
				{review.lineage === 'conflict' ? (
					<>
						<button
							className='decision-button decision-button--primary'
							disabled={busy || onContinueFork === undefined}
							onClick={() => void onContinueFork?.()}
							type='button'
						>
							Continue with my fork
						</button>
						<button
							className='decision-button'
							disabled={busy || onOpenConflictInShape === undefined}
							onClick={() => void onOpenConflictInShape?.()}
							type='button'
						>
							Resolve conflict with Flect
						</button>
						<button
							className='decision-button'
							disabled={busy}
							onClick={() => void onReject()}
							type='button'
						>
							Discard update
						</button>
					</>
				) : (
					<>
						<button
							className='decision-button decision-button--primary'
							disabled={busy || blocked || alreadyCurrent || selected.length === 0}
							onClick={() => {
								if (primary === 'retain') void onRetain(selected);
								else if (primary === 'prepare') void onPrepareUpdate();
								else void onActivate(selected);
							}}
							type='button'
						>
							{primaryLabel}
						</button>
						<button
							className='decision-button'
							disabled={busy}
							onClick={() => void onReject()}
							type='button'
						>
							Discard shared source
						</button>
					</>
				)}
			</div>
		</section>
	);
}
