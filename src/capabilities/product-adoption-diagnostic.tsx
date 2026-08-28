import {
	createProductConnectionRecord,
	defineProductIntegration,
	evaluateProductAdoption,
	type ProductAdoptionSnapshot,
	ProductConnectionRecord,
	ProductHostFacts,
	type ProductInferenceOwner,
	type ProductIntegration,
	ProductUserState
} from '@flect/product';
import { Effect } from 'effect';
import { useEffect, useState } from 'react';
import { makeBrokeredIncidentsProduct } from '../../examples/product-sdk/brokered-incidents';
import { makeBrowserProjectsProduct } from '../../examples/product-sdk/browser-projects';
import { makeOfflineBoardProduct } from '../../examples/product-sdk/offline-board';

export interface ProductAdoptionScenarioModel {
	readonly id: string;
	readonly name: string;
	readonly snapshot: ProductAdoptionSnapshot;
}

export interface ProductAdoptionProductModel {
	readonly id: string;
	readonly name: string;
	readonly connection: ProductIntegration['metadata']['descriptor']['connection'];
	readonly authenticationOwner: ProductIntegration['metadata']['descriptor']['authenticationOwner'];
	readonly inference: ProductIntegration['metadata']['descriptor']['inference'];
	readonly capsuleVersion: string;
	readonly scenarios: ReadonlyArray<ProductAdoptionScenarioModel>;
}

const host = ProductHostFacts.make({
	version: 1,
	flectVersion: '0.2.0',
	platform: 'browser',
	online: true,
	productSessionAvailable: true,
	brokerAvailable: true,
	nativeAuthenticationAvailable: false
});

const userStateFor = (
	integration: ProductIntegration,
	selectedInferenceOwner: ProductInferenceOwner
) =>
	ProductUserState.make({
		version: 1,
		productId: integration.metadata.descriptor.id,
		forkRevision: 'refs/heads/user/personal',
		exportedSnapshotDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		decisionIds: [],
		selectedInferenceOwner
	});

const scenario = Effect.fn('ProductAdoptionDiagnostic.scenario')(
	(
		id: string,
		name: string,
		integration: ProductIntegration,
		options: {
			readonly host?: ProductHostFacts;
			readonly connection?: ProductConnectionRecord;
			readonly detached?: boolean;
		} = {}
	) =>
		evaluateProductAdoption({
			integration,
			host: options.host ?? host,
			connection: options.connection,
			userState: userStateFor(integration, integration.selectedInferenceOwner),
			detached: options.detached ?? false
		}).pipe(Effect.map((snapshot) => ({ id, name, snapshot })))
);

const model = (
	integration: ProductIntegration,
	scenarios: ReadonlyArray<ProductAdoptionScenarioModel>
): ProductAdoptionProductModel => ({
	id: integration.metadata.descriptor.id,
	name: integration.metadata.descriptor.name,
	connection: integration.metadata.descriptor.connection,
	authenticationOwner: integration.metadata.descriptor.authenticationOwner,
	inference: integration.metadata.descriptor.inference,
	capsuleVersion: integration.metadata.experience.capsuleVersion,
	scenarios
});

const changedConnection = (
	integration: ProductIntegration,
	changes: Partial<ProductConnectionRecord>
) =>
	ProductConnectionRecord.make({
		...createProductConnectionRecord(integration),
		...changes
	});

export const loadProductAdoptionDiagnosticModels = Effect.gen(function* () {
	const offline = yield* makeOfflineBoardProduct();
	const browser = yield* makeBrowserProjectsProduct({
		fetch: async () =>
			new Response('{"data":{"projects":[]}}', {
				status: 200,
				headers: { 'content-type': 'application/json' }
			}),
		eventConnector: { open: () => Effect.void }
	});
	const diagnosticCredential = 'product-sdk-private-secret';
	const brokered = yield* makeBrokeredIncidentsProduct({
		broker: () =>
			Effect.sync(() => {
				const credentialRemainsInHostClosure = diagnosticCredential.length > 0;
				return { incidents: [], credentialRemainsInHostClosure };
			})
	});

	const offlineConnection = createProductConnectionRecord(offline.integration);
	const browserConnection = createProductConnectionRecord(browser.integration);
	const brokerConnection = createProductConnectionRecord(brokered.integration);
	const blockedBroker = yield* defineProductIntegration({
		metadata: {
			...brokered.integration.metadata,
			descriptor: {
				...brokered.integration.metadata.descriptor,
				integrationVersion: '2.0.0',
				revision: 'brokered-incidents-v2'
			},
			migrations: [
				{
					version: 1,
					from: '1.0.0',
					to: '2.0.0',
					disposition: 'blocked'
				}
			]
		},
		operations: brokered.integration.operations,
		events: brokered.integration.events,
		selectedInferenceOwner: brokered.integration.selectedInferenceOwner,
		loadRecommendedExperience: brokered.integration.loadRecommendedExperience
	});

	const offlineScenarios = yield* Effect.all([
		scenario('ready', 'Ready', offline.integration),
		scenario('product-update', 'Update with personal fork', offline.integration, {
			connection: changedConnection(offline.integration, {
				productRevision: 'offline-board-v0'
			})
		}),
		scenario('detached', 'Detached', offline.integration, {
			connection: offlineConnection,
			detached: true
		})
	]);
	const browserScenarios = yield* Effect.all([
		scenario('ready', 'Ready', browser.integration),
		scenario('offline', 'Offline', browser.integration, {
			host: ProductHostFacts.make({ ...host, online: false }),
			connection: browserConnection
		}),
		scenario('capability-review', 'Capability review', browser.integration, {
			connection: changedConnection(browser.integration, {
				capabilityDigest: 'c'.repeat(64)
			})
		}),
		scenario('extension-review', 'Extension review', browser.integration, {
			connection: changedConnection(browser.integration, {
				extensionDigest: 'd'.repeat(64)
			})
		})
	]);
	const brokerScenarios = yield* Effect.all([
		scenario('ready', 'Ready', brokered.integration),
		scenario('authentication-unavailable', 'Authentication unavailable', brokered.integration, {
			host: ProductHostFacts.make({ ...host, brokerAvailable: false }),
			connection: brokerConnection
		}),
		scenario('incompatible-host', 'Incompatible host', brokered.integration, {
			host: ProductHostFacts.make({ ...host, platform: 'linux' }),
			connection: brokerConnection
		}),
		scenario('migration-blocked', 'Blocked migration', blockedBroker, {
			connection: brokerConnection
		})
	]);

	return [
		model(offline.integration, offlineScenarios),
		model(browser.integration, browserScenarios),
		model(brokered.integration, brokerScenarios)
	];
});

const connectionLabel = (connection: ProductAdoptionProductModel['connection']) => {
	switch (connection) {
		case 'offline':
			return 'Offline';
		case 'browser-direct':
			return 'Browser direct';
		case 'brokered':
			return 'Named broker';
	}
};

const authenticationLabel = (owner: ProductAdoptionProductModel['authenticationOwner']) => {
	switch (owner) {
		case 'none':
			return 'No authentication';
		case 'product':
			return 'Product session';
		case 'host':
			return 'Host authentication';
	}
};

const inferenceLabel = (model: ProductAdoptionProductModel) => {
	const allowed = model.inference.allowedOwners;
	if (model.inference.defaultOwner === 'user' && allowed.includes('product')) {
		return 'User inference · Product optional';
	}
	if (model.inference.defaultOwner === 'product' && allowed.includes('user')) {
		return 'Product inference · User optional';
	}
	return model.inference.defaultOwner === 'user' ? 'User inference' : 'Product inference';
};

const stateLabel = (state: ProductAdoptionSnapshot['state']) =>
	state.charAt(0).toUpperCase() + state.slice(1);

function ProductCard({ product }: { readonly product: ProductAdoptionProductModel }) {
	const [selected, setSelected] = useState(product.scenarios[0]?.id ?? 'ready');
	const scenario =
		product.scenarios.find((candidate) => candidate.id === selected) ?? product.scenarios[0];
	if (scenario === undefined) return null;
	const snapshot = scenario.snapshot;
	const personalFork = snapshot.userState.forkRevision !== undefined;
	const protectedReview = snapshot.state === 'review' || snapshot.state === 'blocked';
	const headingId = `${product.id}-heading`;

	return (
		<article aria-labelledby={headingId} className='product-adoption-card'>
			<header>
				<div>
					<p className='product-adoption-diagnostic__eyebrow'>
						{connectionLabel(product.connection)}
					</p>
					<h2 id={headingId}>{product.name}</h2>
				</div>
				{/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- role='status' is the WAI-ARIA live-region announcer pattern (implicit aria-live=polite); <output> is for calculated form results, not live-region text, so it is not the right semantic swap here. */}
				<span className={`product-adoption-card__state is-${snapshot.state}`} role='status'>
					{stateLabel(snapshot.state)}
				</span>
			</header>
			<dl className='product-adoption-card__facts'>
				<div className='product-adoption-card__fact'>
					<dt>Connection</dt>
					<dd>{connectionLabel(product.connection)}</dd>
				</div>
				<div className='product-adoption-card__fact'>
					<dt>Authentication</dt>
					<dd>{authenticationLabel(product.authenticationOwner)}</dd>
				</div>
				<div className='product-adoption-card__fact'>
					<dt>Inference</dt>
					<dd>{inferenceLabel(product)}</dd>
				</div>
				<div className='product-adoption-card__fact'>
					<dt>Experience</dt>
					<dd>Recommended {product.capsuleVersion}</dd>
				</div>
			</dl>
			<label className='product-adoption-card__scenario'>
				<span>{product.name} state</span>
				<select
					aria-label={`${product.name} state`}
					onChange={(event) => setSelected(event.currentTarget.value)}
					value={selected}
				>
					{product.scenarios.map((candidate) => (
						<option key={candidate.id} value={candidate.id}>
							{candidate.name}
						</option>
					))}
				</select>
			</label>
			<div className='product-adoption-card__ownership'>
				<span>{personalFork ? 'Personal fork preserved' : 'Recommended experience'}</span>
				{protectedReview ? <strong>Protected review required</strong> : null}
			</div>
			<ol className='product-adoption-card__diagnostics'>
				{snapshot.diagnostics.map((diagnostic) => (
					<li key={diagnostic.reason} data-severity={diagnostic.severity}>
						<span>{diagnostic.severity}</span>
						<div>
							<strong>{diagnostic.message}</strong>
							<p>{diagnostic.action}</p>
						</div>
					</li>
				))}
			</ol>
		</article>
	);
}

export function ProductAdoptionDiagnostic({
	products
}: {
	readonly products: ReadonlyArray<ProductAdoptionProductModel>;
}) {
	return (
		<main className='product-adoption-diagnostic' data-testid='product-adoption-diagnostic'>
			<header className='product-adoption-diagnostic__hero'>
				<p className='product-adoption-diagnostic__eyebrow'>Public adoption contract</p>
				<h1>Product adoption SDK</h1>
				<p>
					Three connection models, one protected authority boundary, and user-owned interfaces that
					remain recoverable.
				</p>
			</header>
			<section aria-label='Reference products' className='product-adoption-diagnostic__grid'>
				{products.map((product) => (
					<ProductCard key={product.id} product={product} />
				))}
			</section>
		</main>
	);
}

export function ProductAdoptionDiagnosticRoute() {
	const [products, setProducts] = useState<ReadonlyArray<ProductAdoptionProductModel>>([]);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let active = true;
		Effect.runPromise(loadProductAdoptionDiagnosticModels).then(
			(loaded) => {
				if (active) setProducts(loaded);
			},
			() => {
				if (active) setFailed(true);
			}
		);
		return () => {
			active = false;
		};
	}, []);
	if (failed) return <main role='alert'>The product adoption diagnostic failed safely.</main>;
	if (products.length === 0) return <main aria-busy='true'>Loading product adoption proof…</main>;
	return <ProductAdoptionDiagnostic products={products} />;
}
