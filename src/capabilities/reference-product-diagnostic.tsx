import { Effect, Fiber, Layer, ManagedRuntime, Schema, Stream } from 'effect';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	makeReferenceProductLayer,
	REFERENCE_OPERATIONS,
	referenceProductContext
} from '../../examples/product-adapter/reference-product';
import type { ProductEventConnector } from '../../packages/product/src/host/product-events';
import {
	type ProductCapabilityDecisionChoice,
	type ProductCapabilityProjection,
	ProductOperationFailure,
	ProductOperationInvocation
} from '../../packages/product/src/product-capability';
import { ProductCapabilities } from '../components/agent-rail';
import { InterfaceStorageLive } from '../lib/interface-store';
import { makeProductCapabilityDecisionStoreLayer } from './product-capability-decision-store';
import { ProductCapabilityRegistry } from './product-capability-registry';
import { ProductEventRegistry } from './product-event-registry';

const diagnosticCredential = 'reference-host-secret-never-public';

interface DiagnosticControls {
	denyNextArchive: boolean;
	transportCount: number;
	credentialApplied: boolean;
}

const makeDiagnostic = () => {
	const controls: DiagnosticControls = {
		denyNextArchive: false,
		transportCount: 0,
		credentialApplied: false
	};
	const connector: ProductEventConnector = {
		open: Effect.fn('ReferenceProductDiagnostic.open')(function* ({ emit }) {
			yield* emit({
				version: 1,
				policyId: 'reference.projects.events.v1',
				sequence: '1',
				payload: { projectId: 'alpha', status: 'active' }
			});
			yield* emit({
				version: 1,
				policyId: 'reference.projects.events.v1',
				sequence: '2',
				payload: { projectId: 'alpha', status: 'archived' }
			});
			return yield* Effect.never;
		})
	};
	const reference = makeReferenceProductLayer({
		inferenceOwner: 'user',
		fetch: async (_input, init) => {
			controls.transportCount += 1;
			const requestBody = init?.body;
			const body = requestBody instanceof Uint8Array ? new TextDecoder().decode(requestBody) : '';
			if (body.includes('ReferenceProjects')) {
				return new Response(
					JSON.stringify({
						data: {
							projects: [{ id: 'alpha', name: 'Alpha', status: 'active' }]
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			controls.credentialApplied =
				new Headers(init?.headers).get('authorization') === `Bearer ${diagnosticCredential}`;
			return new Response(
				JSON.stringify({
					data: { archiveProject: { id: 'alpha', status: 'archived' } }
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		},
		credentialHeaders: (policyId) =>
			Effect.succeed(
				policyId === 'reference.projects.archive.v1'
					? [
							{
								name: 'authorization',
								value: `Bearer ${diagnosticCredential}`
							}
						]
					: []
			),
		authorize: ({ operationId }) => {
			if (operationId === REFERENCE_OPERATIONS.archive && controls.denyNextArchive) {
				controls.denyNextArchive = false;
				return Effect.succeed(false);
			}
			return Effect.succeed(true);
		},
		eventConnector: connector
	});
	const decisionStore = makeProductCapabilityDecisionStoreLayer.pipe(
		Layer.provide(InterfaceStorageLive)
	);
	return {
		controls,
		runtime: ManagedRuntime.make(reference.pipe(Layer.provide(decisionStore)))
	};
};

const publicFailure = (cause: unknown) =>
	Schema.is(ProductOperationFailure)(cause) ? cause.reason : 'request-failed';

export function ReferenceProductDiagnostic() {
	const diagnostic = useMemo(makeDiagnostic, []);
	const eventFiber = useRef<Fiber.Fiber<void, unknown> | undefined>(undefined);
	const [permissions, setPermissions] = useState<ReadonlyArray<ProductCapabilityProjection>>([]);
	const [result, setResult] = useState('Ready');
	const [transportCount, setTransportCount] = useState(0);
	const [credentialState, setCredentialState] = useState('Not used');
	const [eventSequences, setEventSequences] = useState<ReadonlyArray<string>>([]);
	const [eventState, setEventState] = useState('Idle');

	const refresh = useCallback(
		() =>
			diagnostic.runtime.runPromise(
				Effect.gen(function* () {
					const registry = yield* ProductCapabilityRegistry;
					setPermissions(yield* registry.permissions(referenceProductContext));
				})
			),
		[diagnostic]
	);

	const decide = useCallback(
		(_scopeId: string, capabilityId: string, choice: ProductCapabilityDecisionChoice) =>
			diagnostic.runtime
				.runPromise(
					Effect.gen(function* () {
						const registry = yield* ProductCapabilityRegistry;
						yield* registry.decide(referenceProductContext, capabilityId, choice);
					})
				)
				.then(refresh),
		[diagnostic, refresh]
	);

	const revoke = useCallback(
		(decisionId: string) =>
			diagnostic.runtime
				.runPromise(
					Effect.gen(function* () {
						const registry = yield* ProductCapabilityRegistry;
						yield* registry.revoke(decisionId);
					})
				)
				.then(refresh),
		[diagnostic, refresh]
	);

	const invoke = useCallback(
		(operationId: string, input: object = {}) => {
			void diagnostic.runtime
				.runPromise(
					Effect.gen(function* () {
						const registry = yield* ProductCapabilityRegistry;
						return yield* registry.invoke(
							referenceProductContext,
							ProductOperationInvocation.make({
								version: 1,
								operationId,
								input
							})
						);
					})
				)
				.then(
					(output) => setResult(JSON.stringify(output)),
					(cause) => setResult(publicFailure(cause))
				)
				.finally(() => {
					setTransportCount(diagnostic.controls.transportCount);
					setCredentialState(
						diagnostic.controls.credentialApplied ? 'Host credential applied privately' : 'Not used'
					);
				});
		},
		[diagnostic]
	);

	const startEvents = useCallback(() => {
		if (eventFiber.current !== undefined) return;
		setEventSequences([]);
		setEventState('Running');
		eventFiber.current = diagnostic.runtime.runFork(
			Effect.gen(function* () {
				const events = yield* ProductEventRegistry;
				yield* events
					.subscribe(
						referenceProductContext,
						ProductOperationInvocation.make({
							version: 1,
							operationId: REFERENCE_OPERATIONS.subscribe,
							input: { workspaceId: 'reference-workspace' }
						})
					)
					.pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => {
								setEventSequences((current) => [...current, event.sequence]);
							})
						)
					);
			})
		);
	}, [diagnostic]);

	const cancelEvents = useCallback(() => {
		const fiber = eventFiber.current;
		if (fiber === undefined) return;
		eventFiber.current = undefined;
		diagnostic.runtime.runFork(
			Fiber.interrupt(fiber).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						setEventState('Cancelled and released');
					})
				)
			)
		);
	}, [diagnostic]);

	useEffect(() => {
		void refresh();
		return () => {
			const fiber = eventFiber.current;
			if (fiber !== undefined) {
				diagnostic.runtime.runFork(Fiber.interrupt(fiber));
			}
			void diagnostic.runtime.dispose();
		};
	}, [diagnostic, refresh]);

	return (
		<main className='product-capability-diagnostic reference-product-diagnostic'>
			<header>
				<p className='eyebrow'>Flect product-host proof</p>
				<h1>Reference product adapter</h1>
				<p>
					One protected contract across offline work, fixed GraphQL, private host authentication,
					and bounded resumable events.
				</p>
			</header>

			<section aria-label='Reference product permissions' className='capsule-review'>
				<h2>Product authority</h2>
				<ProductCapabilities
					capabilities={permissions}
					onDecide={decide}
					onRevoke={revoke}
					scopeId={referenceProductContext.scopeId}
				/>
			</section>

			<section aria-label='Reference product operations' className='capsule-review'>
				<h2>Named operations</h2>
				<div className='reference-product-diagnostic__actions'>
					<button onClick={() => invoke(REFERENCE_OPERATIONS.status)} type='button'>
						Read offline status
					</button>
					<button
						onClick={() =>
							invoke(REFERENCE_OPERATIONS.list, {
								workspaceId: 'reference-workspace'
							})
						}
						type='button'
					>
						Read projects
					</button>
					<button
						onClick={() => invoke(REFERENCE_OPERATIONS.archive, { projectId: 'alpha' })}
						type='button'
					>
						Archive alpha
					</button>
					<button
						onClick={() => {
							diagnostic.controls.denyNextArchive = true;
						}}
						type='button'
					>
						Deny next archive
					</button>
					<button onClick={startEvents} type='button'>
						Start project events
					</button>
					<button onClick={cancelEvents} type='button'>
						Cancel project events
					</button>
				</div>
				<dl className='reference-product-diagnostic__results'>
					<div>
						<dt>Public result</dt>
						<dd data-testid='reference-result'>{result}</dd>
					</div>
					<div>
						<dt>Product transports</dt>
						<dd data-testid='reference-transport-count'>{transportCount}</dd>
					</div>
					<div>
						<dt>Authentication</dt>
						<dd data-testid='reference-credential-state'>{credentialState}</dd>
					</div>
					<div>
						<dt>Event sequences</dt>
						<dd data-testid='reference-event-sequences'>
							{eventSequences.length === 0 ? 'None' : eventSequences.join(', ')}
						</dd>
					</div>
					<div>
						<dt>Event scope</dt>
						<dd data-testid='reference-event-state'>{eventState}</dd>
					</div>
				</dl>
			</section>
		</main>
	);
}
