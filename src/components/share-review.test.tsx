// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
	SharePrivateInstallationSource,
	ShareUrlInstallationSource
} from '../../shared/share-installation';
import {
	ShareReviewArtifact,
	ShareReviewChange,
	ShareReview as ShareReviewContract,
	ShareSignatureAssessment
} from '../../shared/share-review';
import { ShareReview } from './share-review';

afterEach(cleanup);

const review = ShareReviewContract.make({
	formatVersion: 1,
	shareId: 'dev.flect.weather',
	name: 'Weather workspace',
	version: '1.2.0',
	lineage: 'new',
	origin: ShareUrlInstallationSource.make({
		_tag: 'url',
		url: 'https://example.test/weather.flect-share',
		archiveSha256: 'a'.repeat(64)
	}),
	publisher: 'Akua',
	source: 'https://example.test/weather',
	revision: 'b'.repeat(40),
	compatible: true,
	signature: ShareSignatureAssessment.make({
		status: 'verified',
		keyIds: ['akua:key'],
		authoritative: false
	}),
	artifacts: [
		ShareReviewArtifact.make({
			id: 'dev.flect.weather.component',
			kind: 'component',
			version: '1.2.0',
			sourceRoot: 'components/weather'
		})
	],
	changes: [
		ShareReviewChange.make({
			category: 'interface',
			kind: 'added',
			path: 'components/weather/index.tsx',
			authorityAffecting: false
		})
	],
	blockers: [],
	actions: ['install', 'fork', 'reject'],
	inactive: true
});

describe('ShareReview', () => {
	it('keeps shared content inactive and sends only selected artifact ids', () => {
		const onRetain = vi.fn();
		const onReject = vi.fn();
		render(
			<ShareReview
				onActivate={vi.fn()}
				onPrepareUpdate={vi.fn()}
				onReject={onReject}
				onRetain={onRetain}
				pending={false}
				retained={false}
				review={review}
			/>
		);

		expect(screen.getByRole('heading', { name: 'Weather workspace' })).toBeVisible();
		expect(screen.getByText('Inactive until you activate it')).toBeVisible();
		fireEvent.click(screen.getByRole('button', { name: 'Retain selected' }));
		expect(onRetain).toHaveBeenCalledWith(['dev.flect.weather.component']);
		fireEvent.click(screen.getByRole('button', { name: 'Discard shared source' }));
		expect(onReject).toHaveBeenCalledOnce();
	});

	it('keeps source replacement reachable while the agent rail is obscured', () => {
		const onOpenSource = vi.fn();
		const onOpenFile = vi.fn();
		render(
			<ShareReview
				onActivate={vi.fn()}
				onOpenFile={onOpenFile}
				onOpenSource={onOpenSource}
				onPrepareUpdate={vi.fn()}
				onReject={vi.fn()}
				onRetain={vi.fn()}
				pending={false}
				retained={false}
				review={review}
			/>
		);

		fireEvent.click(screen.getByRole('button', { name: 'Open URL or Git' }));
		fireEvent.click(screen.getByRole('button', { name: 'Open shared file' }));
		expect(onOpenSource).toHaveBeenCalledOnce();
		expect(onOpenFile).toHaveBeenCalledOnce();
	});

	it('disables activation and explains review blockers', () => {
		render(
			<ShareReview
				onActivate={vi.fn()}
				onPrepareUpdate={vi.fn()}
				onReject={vi.fn()}
				onRetain={vi.fn()}
				pending
				retained
				review={ShareReviewContract.make({
					...review,
					compatible: false,
					blockers: ['incompatible']
				})}
			/>
		);

		expect(screen.getByRole('button', { name: 'Preview selected' })).toBeDisabled();
		expect(screen.getByRole('alert')).toHaveTextContent('incompatible');
	});

	it('explains signature, compatibility, origin, and authority without implying trust', () => {
		render(
			<ShareReview
				onActivate={vi.fn()}
				onPrepareUpdate={vi.fn()}
				onReject={vi.fn()}
				onRetain={vi.fn()}
				pending={false}
				retained={false}
				review={ShareReviewContract.make({
					...review,
					origin: SharePrivateInstallationSource.make({
						_tag: 'private',
						adapterId: 'company-share',
						referenceSha256: 'c'.repeat(64),
						archiveSha256: 'd'.repeat(64)
					}),
					changes: [
						ShareReviewChange.make({
							category: 'instructions',
							kind: 'modified',
							path: 'AGENTS.md',
							authorityAffecting: true
						})
					]
				})}
			/>
		);

		expect(screen.getByText('Signature verified')).toBeVisible();
		expect(screen.getByText(/does not grant access/i)).toBeVisible();
		expect(screen.getByText(/compatible with this flect/i)).toBeVisible();
		expect(screen.getByText(/private source · company-share/i)).toBeVisible();
		expect(screen.getByText(/1 authority-affecting change/i)).toBeVisible();
		expect(screen.queryByText(/token|credential|endpoint/i)).not.toBeInTheDocument();
	});

	it('blocks invalid signatures even when the share is otherwise compatible', () => {
		render(
			<ShareReview
				onActivate={vi.fn()}
				onPrepareUpdate={vi.fn()}
				onReject={vi.fn()}
				onRetain={vi.fn()}
				pending={false}
				retained={false}
				review={ShareReviewContract.make({
					...review,
					signature: ShareSignatureAssessment.make({
						status: 'invalid',
						keyIds: ['invalid:key'],
						authoritative: false
					}),
					blockers: ['invalid-signature']
				})}
			/>
		);

		expect(screen.getByRole('button', { name: 'Retain selected' })).toBeDisabled();
	});

	it('announces a newly opened review without scrolling the document', async () => {
		render(
			<ShareReview
				onActivate={vi.fn()}
				onPrepareUpdate={vi.fn()}
				onReject={vi.fn()}
				onRetain={vi.fn()}
				pending={false}
				retained={false}
				review={review}
			/>
		);

		await waitFor(() =>
			expect(screen.getByRole('region', { name: 'Weather workspace' })).toHaveFocus()
		);
		expect(window.scrollY).toBe(0);
	});

	it('does not prepare a no-op update that is already installed', () => {
		render(
			<ShareReview
				installedVersion='1.2.0'
				onActivate={vi.fn()}
				onPrepareUpdate={vi.fn()}
				onReject={vi.fn()}
				onRetain={vi.fn()}
				pending={false}
				retained
				review={ShareReviewContract.make({
					...review,
					lineage: 'update',
					changes: []
				})}
			/>
		);

		expect(screen.getByText('No changes to apply')).toBeVisible();
		expect(screen.getByRole('button', { name: 'Already current' })).toBeDisabled();
	});

	it('offers explicit model-free conflict choices and never enables activation', () => {
		const onContinueFork = vi.fn();
		const onOpenConflictInShape = vi.fn();
		const onReject = vi.fn();
		render(
			<ShareReview
				onActivate={vi.fn()}
				onContinueFork={onContinueFork}
				onOpenConflictInShape={onOpenConflictInShape}
				onPrepareUpdate={vi.fn()}
				onReject={onReject}
				onRetain={vi.fn()}
				pending
				retained
				review={ShareReviewContract.make({
					...review,
					lineage: 'conflict',
					blockers: ['conflict'],
					actions: ['continue-fork', 'shape-conflict', 'reject'],
					changes: [
						ShareReviewChange.make({
							category: 'interface',
							kind: 'conflict',
							path: 'components/weather/index.tsx',
							authorityAffecting: false
						})
					]
				})}
			/>
		);

		expect(screen.queryByRole('button', { name: 'Preview selected' })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Continue with my fork' }));
		fireEvent.click(screen.getByRole('button', { name: 'Resolve conflict with Flect' }));
		fireEvent.click(screen.getByRole('button', { name: 'Discard update' }));
		expect(onContinueFork).toHaveBeenCalledOnce();
		expect(onOpenConflictInShape).toHaveBeenCalledOnce();
		expect(onReject).toHaveBeenCalledOnce();
	});
});
