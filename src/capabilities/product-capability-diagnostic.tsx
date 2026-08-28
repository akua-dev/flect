import { Effect, Layer, ManagedRuntime } from 'effect';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	AuthorizedProductOperation,
	type ProductCapabilityDecisionChoice,
	ProductCapabilityManifest,
	type ProductCapabilityProjection,
	ProductCapabilityRequestContext
} from '../../packages/product/src/product-capability';
import { ProductCapabilities } from '../components/agent-rail';
import { InterfaceStorageLive } from '../lib/interface-store';
import { makeProductCapabilityBrokerLayer } from './product-capability-broker';
import { makeProductCapabilityDecisionStoreLayer } from './product-capability-decision-store';
import {
	makeProductCapabilityRegistryLayer,
	ProductCapabilityRegistry
} from './product-capability-registry';

const capabilityId = 'product:projects:read';
const projectsScope = 'dev.akua.projects';
const reportsScope = 'dev.akua.reports';
const manifest = ProductCapabilityManifest.make({
	version: 1,
	id: capabilityId,
	name: 'Read projects',
	description: 'View project names and status.',
	operationIds: ['projects.list'],
	resourceIds: ['projects.workspace'],
	dataClassIds: ['projects.summary'],
	confirmationPolicies: ['once', 'session', 'workspace', 'persistent']
});

const requestFor = (scopeId: string, requestDigest: string) =>
	ProductCapabilityRequestContext.make({
		version: 1,
		scopeId,
		workspaceId: 'workspace-local-default',
		requestDigest,
		revision: `revision-${scopeId}`,
		capabilities: [{ capabilityId, required: true }]
	});

const projectsRequest = requestFor(
	projectsScope,
	'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
const reportsRequest = requestFor(
	reportsScope,
	'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);

const decisionStore = makeProductCapabilityDecisionStoreLayer.pipe(
	Layer.provide(InterfaceStorageLive)
);
const broker = makeProductCapabilityBrokerLayer({
	manifests: [manifest]
}).pipe(Layer.provide(decisionStore));
const registry = makeProductCapabilityRegistryLayer({
	operations: [
		{
			id: 'projects.list',
			capabilityId,
			authorize: () =>
				Effect.succeed(
					AuthorizedProductOperation.make({
						version: 1,
						capabilityId,
						operationId: 'projects.list',
						resourceIds: ['projects.workspace'],
						dataClassIds: ['projects.summary']
					})
				),
			execute: () => Effect.succeed(null)
		}
	]
}).pipe(Layer.provide(broker));

export function ProductCapabilityDiagnostic() {
	const runtime = useMemo(() => ManagedRuntime.make(registry), []);
	const [projects, setProjects] = useState<ReadonlyArray<ProductCapabilityProjection>>([]);
	const [reports, setReports] = useState<ReadonlyArray<ProductCapabilityProjection>>([]);
	const refresh = useCallback(
		() =>
			runtime.runPromise(
				Effect.gen(function* () {
					const service = yield* ProductCapabilityRegistry;
					const [projectPermissions, reportPermissions] = yield* Effect.all([
						service.permissions(projectsRequest),
						service.permissions(reportsRequest)
					]);
					setProjects(projectPermissions.filter((permission) => permission.requested));
					setReports(reportPermissions.filter((permission) => permission.requested));
				})
			),
		[runtime]
	);
	const decide = useCallback(
		(scopeId: string, selectedCapabilityId: string, choice: ProductCapabilityDecisionChoice) =>
			runtime
				.runPromise(
					Effect.gen(function* () {
						const service = yield* ProductCapabilityRegistry;
						const request = scopeId === projectsScope ? projectsRequest : reportsRequest;
						yield* service.decide(request, selectedCapabilityId, choice);
					})
				)
				.then(refresh),
		[refresh, runtime]
	);
	const revoke = useCallback(
		(decisionId: string) =>
			runtime
				.runPromise(
					Effect.gen(function* () {
						const service = yield* ProductCapabilityRegistry;
						yield* service.revoke(decisionId);
					})
				)
				.then(refresh),
		[refresh, runtime]
	);

	useEffect(() => {
		void refresh();
		return () => {
			void runtime.dispose();
		};
	}, [refresh, runtime]);

	return (
		<main className='product-capability-diagnostic'>
			<h1>Product capability diagnostic</h1>
			<section aria-label='Projects app' className='capsule-review'>
				<h2>Projects app</h2>
				<ProductCapabilities
					capabilities={projects}
					onDecide={decide}
					onRevoke={revoke}
					scopeId={projectsScope}
				/>
			</section>
			<section aria-label='Reports app' className='capsule-review'>
				<h2>Reports app</h2>
				<ProductCapabilities
					capabilities={reports}
					onDecide={decide}
					onRevoke={revoke}
					scopeId={reportsScope}
				/>
			</section>
		</main>
	);
}
