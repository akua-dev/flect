import { useState } from 'react';
import type {
	ExtensionCapability,
	PortableExtensionBinding,
	PortableExtensionCatalogSnapshot,
	PortableExtensionPackage,
	PortableExtensionRole,
	PortableExtensionRoleState
} from '../../packages/product/src/extensions';

export interface ExtensionReviewKey {
	readonly capsuleId: string;
	readonly extensionId: string;
	readonly role: PortableExtensionRole;
	readonly binding: PortableExtensionBinding;
}

export interface ExtensionReviewProps {
	readonly capsuleId: string;
	readonly packages: ReadonlyArray<PortableExtensionPackage>;
	readonly entries: PortableExtensionCatalogSnapshot['entries'];
	readonly binding: PortableExtensionBinding;
	readonly disabled?: boolean;
	readonly onSetEnabled: (
		key: ExtensionReviewKey,
		enabled: boolean,
		grants: ReadonlyArray<ExtensionCapability>
	) => Promise<void>;
	readonly onTest: (key: ExtensionReviewKey) => Promise<void>;
	readonly onSetPinned: (key: ExtensionReviewKey, pinned: boolean) => Promise<void>;
	readonly onFork: (key: ExtensionReviewKey, revision: string) => Promise<void>;
	readonly onResolveUpdate: (key: ExtensionReviewKey, choice: 'upstream' | 'fork') => Promise<void>;
	readonly onRemove: (key: ExtensionReviewKey) => Promise<void>;
}

const roleLabel = (role: PortableExtensionRole) => (role === 'app' ? 'App Agent' : 'Shaper');

const stateLabel = (entry: PortableExtensionRoleState) => {
	switch (entry.state) {
		case 'available':
			return 'Available · off';
		case 'enabled':
			return entry.binding === 'candidate' && !entry.tested ? 'Enabled · test required' : 'Enabled';
		case 'disabled':
			return 'Disabled';
		case 'failed':
			return 'Failed safely';
		case 'conflict':
			return 'Update conflict';
		case 'incompatible':
			return 'Incompatible';
	}
};

const entryKey = (entry: PortableExtensionRoleState) =>
	`${entry.capsuleId}:${entry.extensionId}:${entry.binding}:${entry.role}`;

const extensionKey = (entry: PortableExtensionRoleState): ExtensionReviewKey => ({
	capsuleId: entry.capsuleId,
	extensionId: entry.extensionId,
	role: entry.role,
	binding: entry.binding
});

const defaultGrants = (entry: PortableExtensionRoleState): ReadonlyArray<ExtensionCapability> => [
	...new Set([...entry.requiredCapabilities, ...entry.grantedCapabilities])
];

const memoryLabel = (bytes: number) => {
	const mib = bytes / (1024 * 1024);
	return `${Number.isInteger(mib) ? mib.toFixed(0) : mib.toFixed(1)} MiB`;
};

interface RoleReviewProps extends Omit<
	ExtensionReviewProps,
	'binding' | 'capsuleId' | 'packages' | 'entries'
> {
	readonly extension: PortableExtensionPackage;
	readonly entry: PortableExtensionRoleState;
}

function ExtensionRoleReview({
	extension,
	entry,
	disabled = false,
	onSetEnabled,
	onTest,
	onSetPinned,
	onFork,
	onResolveUpdate,
	onRemove
}: RoleReviewProps) {
	const key = extensionKey(entry);
	const id = entryKey(entry);
	const role = roleLabel(entry.role);
	const [grants, setGrants] = useState<ReadonlyArray<ExtensionCapability>>(() =>
		defaultGrants(entry)
	);
	const [forkRevision, setForkRevision] = useState(
		entry.forkRevision ?? `local-${entry.provenanceRevision}`
	);
	const [pending, setPending] = useState(false);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const [status, setStatus] = useState<string>();

	const perform = async (label: string, action: () => Promise<void>) => {
		if (pending || disabled) return;
		setPending(true);
		setStatus(`${label}…`);
		try {
			await action();
			setStatus(`${label} complete.`);
		} catch {
			setStatus(`${label} failed safely. Review diagnostics and try again.`);
		} finally {
			setPending(false);
		}
	};

	const toggleGrant = (capability: ExtensionCapability, checked: boolean) => {
		setGrants((current) =>
			checked
				? current.includes(capability)
					? current
					: [...current, capability]
				: current.filter((candidate) => candidate !== capability)
		);
	};

	const test = () =>
		perform(`Testing ${role}`, async () => {
			if (entry.state === 'failed') {
				await onSetEnabled(key, true, grants);
			}
			await onTest(key);
		});

	const enabled = entry.state === 'enabled';
	const canEnable = entry.state !== 'incompatible' && entry.state !== 'conflict';

	return (
		<fieldset
			aria-describedby={`${id}-state`}
			className='extension-review__role'
			disabled={disabled || pending}
		>
			<legend>{role}</legend>
			<span className='extension-review__state' id={`${id}-state`}>
				{stateLabel(entry)}
				{entry.pinned ? ' · pinned' : ''}
				{entry.forkRevision === undefined ? '' : ` · fork ${entry.forkRevision}`}
			</span>

			<div className='extension-review__authority'>
				<strong>Requested access</strong>
				{extension.capabilities.length === 0 ? (
					<span>No interface authority requested.</span>
				) : (
					<ul>
						{extension.capabilities.map((capability) => {
							const required = entry.requiredCapabilities.includes(capability.id);
							return (
								<li key={capability.id}>
									<label>
										<input
											checked={grants.includes(capability.id)}
											disabled={required || disabled || pending}
											onChange={(event) => toggleGrant(capability.id, event.currentTarget.checked)}
											type='checkbox'
										/>
										<span>
											{capability.id} · {required ? 'required' : 'optional'}
										</span>
									</label>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			{entry.failure !== undefined && (
				<p className='extension-review__failure' role='alert'>
					{entry.failure.message} {entry.failure.recovery}
				</p>
			)}
			{entry.state === 'incompatible' && (
				<p className='extension-review__failure' role='alert'>
					This package cannot run on this Flect version or host.
				</p>
			)}

			<div className='extension-review__actions'>
				{canEnable && (
					<button
						className='decision-button'
						onClick={() =>
							void perform(`${enabled ? 'Disabling' : 'Enabling'} ${role}`, () =>
								onSetEnabled(key, !enabled, enabled ? [] : grants)
							)
						}
						type='button'
					>
						{enabled ? `Disable for ${role}` : `Enable for ${role}`}
					</button>
				)}
				{entry.binding === 'candidate' &&
					(entry.state === 'enabled' || entry.state === 'failed') && (
						<button
							className='decision-button decision-button--primary'
							onClick={() => void test()}
							type='button'
						>
							Test for {role}
						</button>
					)}
				<button
					className='decision-button'
					onClick={() =>
						void perform(`${entry.pinned ? 'Unpinning' : 'Pinning'} ${role}`, () =>
							onSetPinned(key, !entry.pinned)
						)
					}
					type='button'
				>
					{entry.pinned ? `Unpin ${role} version` : `Pin ${role} version`}
				</button>
			</div>

			{entry.state === 'conflict' && entry.binding === 'candidate' && (
				<div className='extension-review__conflict'>
					<strong>This update conflicts with the current fork or pin.</strong>
					<span>
						Use upstream to replace it, or discard this app update to keep the current package.
					</span>
					<div className='extension-review__actions'>
						<button
							className='decision-button'
							onClick={() =>
								void perform(`Using upstream for ${role}`, () => onResolveUpdate(key, 'upstream'))
							}
							type='button'
						>
							Use upstream for {role}
						</button>
					</div>
				</div>
			)}

			<details className='extension-review__advanced'>
				<summary>Version controls</summary>
				<label htmlFor={`${id}-fork`}>Local fork revision for {role}</label>
				<div className='extension-review__fork'>
					<input
						id={`${id}-fork`}
						maxLength={120}
						onChange={(event) => setForkRevision(event.currentTarget.value)}
						pattern={'[A-Za-z0-9._\\/\\-]+'}
						value={forkRevision}
					/>
					<button
						className='decision-button'
						disabled={forkRevision.length === 0}
						onClick={() => void perform(`Forking for ${role}`, () => onFork(key, forkRevision))}
						type='button'
					>
						Fork for {role}
					</button>
				</div>
				{confirmRemove ? (
					<div className='extension-review__remove-confirm'>
						<span role='status'>Removal needs confirmation.</span>
						<button
							className='decision-button decision-button--danger'
							onClick={() => void perform(`Removing from ${role}`, () => onRemove(key))}
							type='button'
						>
							Confirm remove from {role}
						</button>
						<button
							className='decision-button'
							onClick={() => setConfirmRemove(false)}
							type='button'
						>
							Cancel removal
						</button>
					</div>
				) : (
					<button className='decision-button' onClick={() => setConfirmRemove(true)} type='button'>
						Remove from {role}
					</button>
				)}
			</details>

			{status !== undefined && (
				<p aria-live='polite' className='extension-review__operation' role='status'>
					{status}
				</p>
			)}
		</fieldset>
	);
}

export function ExtensionReview({
	capsuleId,
	packages,
	entries,
	binding,
	...actions
}: ExtensionReviewProps) {
	const visible = packages.flatMap((extension) => {
		const roleEntries = extension.roles.flatMap((role) => {
			const entry = entries.find(
				(candidate) =>
					candidate.extensionId === extension.id &&
					candidate.capsuleId === capsuleId &&
					candidate.role === role &&
					candidate.binding === binding
			);
			return entry === undefined ? [] : [entry];
		});
		return roleEntries.length === 0 ? [] : [{ extension, roleEntries }];
	});

	if (visible.length === 0) return null;

	return (
		<section aria-label='Portable extensions' className='extension-review'>
			<header className='extension-review__intro'>
				<strong>Portable extensions</strong>
				<p>
					Untrusted package code stays in a bounded browser sandbox. Each role receives only the
					access you enable here.
				</p>
			</header>
			{visible.map(({ extension, roleEntries }) => (
				<article className='extension-review__package' key={extension.id}>
					<header>
						<div>
							<h3>{extension.name}</h3>
							<p>{extension.description}</p>
						</div>
						<span>
							{extension.provenance.publisher} · {extension.version} ·{' '}
							{extension.provenance.revision}
						</span>
					</header>
					<dl>
						<div>
							<dt>Source</dt>
							<dd>{extension.provenance.source}</dd>
						</div>
						<div>
							<dt>Limits</dt>
							<dd>
								{extension.resources.deadlineMs} ms deadline ·{' '}
								{memoryLabel(extension.resources.memoryBytes)} memory ·{' '}
								{extension.resources.maxIntents} intents
							</dd>
						</div>
					</dl>
					<div className='extension-review__roles'>
						{roleEntries.map((entry) => (
							<ExtensionRoleReview
								entry={entry}
								extension={extension}
								key={entryKey(entry)}
								{...actions}
							/>
						))}
					</div>
				</article>
			))}
		</section>
	);
}
