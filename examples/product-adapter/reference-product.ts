import { Context, Effect, Layer, Schema, type SchemaAST } from 'effect';
import {
	makeProductEventsLayer,
	type ProductEventConnector
} from '../../packages/product/src/host/product-events';
import {
	makeProductGraphqlLayer,
	ProductGraphql
} from '../../packages/product/src/host/product-graphql';
import {
	AuthorizedProductOperation,
	ProductCapabilityManifest,
	ProductCapabilityRequestContext,
	type ProductJson,
	type ProductOperationFailure
} from '../../packages/product/src/product-capability';
import {
	ProductEventPolicy,
	ProductEventRequest,
	ProductEventSequence
} from '../../packages/product/src/product-events';
import {
	ProductGraphqlPolicy,
	ProductGraphqlRequest
} from '../../packages/product/src/product-graphql';
import type { ProductHttpHeader } from '../../packages/product/src/product-http';
import { makeProductCapabilityBrokerLayer } from '../../src/capabilities/product-capability-broker';
import {
	makeProductCapabilityRegistryLayer,
	type ProductOperationDefinition
} from '../../src/capabilities/product-capability-registry';
import {
	makeProductEventRegistryLayer,
	type ProductEventDefinition
} from '../../src/capabilities/product-event-registry';
import { productOperationFailure } from '../../src/capabilities/product-operation-failure';

const strict: SchemaAST.ParseOptions = {
	errors: 'all',
	onExcessProperty: 'error'
};

export const REFERENCE_CAPABILITIES = {
	status: 'product.reference.status',
	read: 'product.reference.projects.read',
	write: 'product.reference.projects.write',
	events: 'product.reference.projects.events'
} as const;

export const REFERENCE_OPERATIONS = {
	status: 'reference.status',
	list: 'reference.projects.list',
	archive: 'reference.projects.archive',
	subscribe: 'reference.projects.subscribe'
} as const;

export const REFERENCE_POLICIES = {
	list: 'reference.projects.list.v1',
	archive: 'reference.projects.archive.v1',
	events: 'reference.projects.events.v1'
} as const;

export const referenceProductContext = ProductCapabilityRequestContext.make({
	version: 1,
	scopeId: 'dev.flect.reference-product',
	workspaceId: 'workspace-reference-product',
	requestDigest: 'cd4432053439d08463cef5ade1450209bbd643bd654dfd668c28d62ce9a77b1e',
	revision: 'reference-product-v1',
	capabilities: [
		{ capabilityId: REFERENCE_CAPABILITIES.status, required: true },
		{ capabilityId: REFERENCE_CAPABILITIES.read, required: true },
		{ capabilityId: REFERENCE_CAPABILITIES.write, required: false },
		{ capabilityId: REFERENCE_CAPABILITIES.events, required: false }
	]
});

export const REFERENCE_PROJECTS_DOCUMENT =
	'query ReferenceProjects($workspaceId: ID!) {\n  projects(workspaceId: $workspaceId) { id name status }\n}';
export const REFERENCE_ARCHIVE_DOCUMENT =
	'mutation ReferenceArchiveProject($projectId: ID!) {\n  archiveProject(projectId: $projectId) { id status }\n}';

const StatusInput = Schema.Struct({});
const ListInput = Schema.Struct({
	workspaceId: Schema.Literal('reference-workspace')
});
const ArchiveInput = Schema.Struct({ projectId: Schema.Literal('alpha') });
const SubscribeInput = Schema.Struct({
	workspaceId: Schema.Literal('reference-workspace'),
	resumeAfter: Schema.optionalKey(ProductEventSequence)
});

const manifests = [
	ProductCapabilityManifest.make({
		version: 1,
		id: REFERENCE_CAPABILITIES.status,
		name: 'Read local status',
		description: 'Read deterministic status without a network request.',
		operationIds: [REFERENCE_OPERATIONS.status],
		resourceIds: ['reference.workspace'],
		dataClassIds: ['reference.status'],
		confirmationPolicies: ['once', 'session', 'workspace', 'persistent']
	}),
	ProductCapabilityManifest.make({
		version: 1,
		id: REFERENCE_CAPABILITIES.read,
		name: 'Read reference projects',
		description: 'Read bounded project summaries from the reference product.',
		operationIds: [REFERENCE_OPERATIONS.list],
		resourceIds: ['reference.workspace'],
		dataClassIds: ['reference.projects.summary'],
		confirmationPolicies: ['once', 'session', 'workspace', 'persistent']
	}),
	ProductCapabilityManifest.make({
		version: 1,
		id: REFERENCE_CAPABILITIES.write,
		name: 'Archive a reference project',
		description: 'Archive the single reference project through a fixed mutation.',
		operationIds: [REFERENCE_OPERATIONS.archive],
		resourceIds: ['reference.project.alpha'],
		dataClassIds: ['reference.projects.status'],
		confirmationPolicies: ['once', 'session', 'workspace', 'persistent']
	}),
	ProductCapabilityManifest.make({
		version: 1,
		id: REFERENCE_CAPABILITIES.events,
		name: 'Watch reference projects',
		description: 'Receive bounded, ordered project status events.',
		operationIds: [REFERENCE_OPERATIONS.subscribe],
		resourceIds: ['reference.workspace'],
		dataClassIds: ['reference.projects.event'],
		confirmationPolicies: ['once', 'session', 'workspace', 'persistent']
	})
] as const;

const listPolicy = ProductGraphqlPolicy.make({
	version: 1,
	id: REFERENCE_POLICIES.list,
	endpoint: 'https://reference.example/graphql',
	operationId: REFERENCE_OPERATIONS.list,
	operationName: 'ReferenceProjects',
	operationType: 'query',
	documentSha256: '621a130bb2459d1afbdaa2517354d1bf65d314c742a4dd3faf0f1090814072b5',
	requestBytes: 16 * 1024,
	responseBytes: 64 * 1024,
	deadlineMs: 5_000
});

const archivePolicy = ProductGraphqlPolicy.make({
	version: 1,
	id: REFERENCE_POLICIES.archive,
	endpoint: 'https://reference.example/graphql',
	operationId: REFERENCE_OPERATIONS.archive,
	operationName: 'ReferenceArchiveProject',
	operationType: 'mutation',
	documentSha256: '98acdf51824f50006ffe13410e0e5ffcfc37968ccf87ee193442ccbdd8cab9fd',
	requestBytes: 16 * 1024,
	responseBytes: 64 * 1024,
	deadlineMs: 5_000
});

const eventPolicy = ProductEventPolicy.make({
	version: 1,
	id: REFERENCE_POLICIES.events,
	operationId: REFERENCE_OPERATIONS.subscribe,
	bufferCapacity: 8,
	eventBytes: 16 * 1024,
	reconnectAttempts: 2,
	reconnectDelayMs: 250,
	sequenceResume: true
});

export type ReferenceInferenceOwner = 'user' | 'product';

export interface ReferenceProductAuthorizationRequest {
	readonly operationId: string;
	readonly input: ProductJson;
}

export interface ReferenceProductConfigurationShape {
	readonly inferenceOwner: ReferenceInferenceOwner;
}

export class ReferenceProductConfiguration extends Context.Service<
	ReferenceProductConfiguration,
	ReferenceProductConfigurationShape
>()('flect/examples/ReferenceProductConfiguration') {}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ReferenceProductOptions {
	readonly inferenceOwner?: ReferenceInferenceOwner;
	readonly fetch?: Fetch;
	readonly credentialHeaders?: (
		policyId: string
	) => Effect.Effect<ReadonlyArray<ProductHttpHeader>>;
	readonly authorize?: (request: ReferenceProductAuthorizationRequest) => Effect.Effect<boolean>;
	readonly eventConnector: ProductEventConnector;
}

const decodeInput = <A>(
	operationId: string,
	schema: Schema.ConstraintDecoder<A, never>,
	input: ProductJson
) =>
	Schema.decodeUnknownEffect(
		schema,
		strict
	)(input).pipe(Effect.mapError(() => productOperationFailure(operationId, 'invalid-input')));

const mapGraphqlFailure = (
	operationId: string,
	reason:
		| 'invalid-policy'
		| 'denied'
		| 'invalid-variables'
		| 'transport'
		| 'deadline'
		| 'oversized-response'
		| 'invalid-response'
		| 'product-denied'
) => {
	switch (reason) {
		case 'product-denied':
			return productOperationFailure(operationId, 'product-denied');
		case 'denied':
			return productOperationFailure(operationId, 'denied');
		case 'invalid-variables':
			return productOperationFailure(operationId, 'invalid-input');
		case 'invalid-policy':
			return productOperationFailure(operationId, 'unavailable');
		case 'transport':
		case 'deadline':
		case 'oversized-response':
		case 'invalid-response':
			return productOperationFailure(operationId, 'request-failed');
	}
};

const exactAuthorization =
	(options: ReferenceProductOptions) =>
	(
		operationId: string,
		capabilityId: string,
		resourceIds: ReadonlyArray<string>,
		dataClassIds: ReadonlyArray<string>,
		input: ProductJson
	): Effect.Effect<AuthorizedProductOperation, ProductOperationFailure> =>
		(options.authorize?.({ operationId, input }) ?? Effect.succeed(true)).pipe(
			Effect.flatMap((allowed) =>
				allowed
					? Effect.succeed(
							AuthorizedProductOperation.make({
								version: 1,
								capabilityId,
								operationId,
								resourceIds: [...resourceIds],
								dataClassIds: [...dataClassIds]
							})
						)
					: Effect.fail(productOperationFailure(operationId, 'product-denied'))
			)
		);

const makeUnaryDefinitions = (
	options: ReferenceProductOptions,
	graphql: Context.Service.Shape<typeof ProductGraphql>
): ReadonlyArray<ProductOperationDefinition> => {
	const authorize = exactAuthorization(options);
	return [
		{
			id: REFERENCE_OPERATIONS.status,
			capabilityId: REFERENCE_CAPABILITIES.status,
			authorize: (input) =>
				decodeInput(REFERENCE_OPERATIONS.status, StatusInput, input).pipe(
					Effect.flatMap(() =>
						authorize(
							REFERENCE_OPERATIONS.status,
							REFERENCE_CAPABILITIES.status,
							['reference.workspace'],
							['reference.status'],
							input
						)
					)
				),
			execute: (input) =>
				decodeInput(REFERENCE_OPERATIONS.status, StatusInput, input).pipe(
					Effect.map(() => ({ status: 'ready' }))
				)
		},
		{
			id: REFERENCE_OPERATIONS.list,
			capabilityId: REFERENCE_CAPABILITIES.read,
			authorize: (input) =>
				decodeInput(REFERENCE_OPERATIONS.list, ListInput, input).pipe(
					Effect.flatMap(() =>
						authorize(
							REFERENCE_OPERATIONS.list,
							REFERENCE_CAPABILITIES.read,
							['reference.workspace'],
							['reference.projects.summary'],
							input
						)
					)
				),
			execute: (input) =>
				decodeInput(REFERENCE_OPERATIONS.list, ListInput, input).pipe(
					Effect.flatMap((variables) =>
						graphql
							.invoke(
								ProductGraphqlRequest.make({
									version: 1,
									policyId: REFERENCE_POLICIES.list,
									variables
								})
							)
							.pipe(
								Effect.mapError((error) =>
									mapGraphqlFailure(REFERENCE_OPERATIONS.list, error.reason)
								)
							)
					),
					Effect.flatMap((response) =>
						response.data === undefined
							? Effect.fail(productOperationFailure(REFERENCE_OPERATIONS.list, 'invalid-output'))
							: Effect.succeed(response.data)
					)
				)
		},
		{
			id: REFERENCE_OPERATIONS.archive,
			capabilityId: REFERENCE_CAPABILITIES.write,
			authorize: (input) =>
				decodeInput(REFERENCE_OPERATIONS.archive, ArchiveInput, input).pipe(
					Effect.flatMap(() =>
						authorize(
							REFERENCE_OPERATIONS.archive,
							REFERENCE_CAPABILITIES.write,
							['reference.project.alpha'],
							['reference.projects.status'],
							input
						)
					)
				),
			execute: (input) =>
				decodeInput(REFERENCE_OPERATIONS.archive, ArchiveInput, input).pipe(
					Effect.flatMap((variables) =>
						graphql
							.invoke(
								ProductGraphqlRequest.make({
									version: 1,
									policyId: REFERENCE_POLICIES.archive,
									variables
								})
							)
							.pipe(
								Effect.mapError((error) =>
									mapGraphqlFailure(REFERENCE_OPERATIONS.archive, error.reason)
								)
							)
					),
					Effect.flatMap((response) =>
						response.data === undefined
							? Effect.fail(productOperationFailure(REFERENCE_OPERATIONS.archive, 'invalid-output'))
							: Effect.succeed(response.data)
					)
				)
		}
	];
};

const makeEventDefinitions = (
	options: ReferenceProductOptions
): ReadonlyArray<ProductEventDefinition> => {
	const authorize = exactAuthorization(options);
	return [
		{
			id: REFERENCE_OPERATIONS.subscribe,
			capabilityId: REFERENCE_CAPABILITIES.events,
			policyId: REFERENCE_POLICIES.events,
			authorize: (input) =>
				decodeInput(REFERENCE_OPERATIONS.subscribe, SubscribeInput, input).pipe(
					Effect.flatMap(() =>
						authorize(
							REFERENCE_OPERATIONS.subscribe,
							REFERENCE_CAPABILITIES.events,
							['reference.workspace'],
							['reference.projects.event'],
							input
						)
					)
				),
			request: (input) =>
				decodeInput(REFERENCE_OPERATIONS.subscribe, SubscribeInput, input).pipe(
					Effect.map((decoded) =>
						ProductEventRequest.make({
							version: 1,
							policyId: REFERENCE_POLICIES.events,
							input: { workspaceId: decoded.workspaceId },
							...(decoded.resumeAfter === undefined ? {} : { resumeAfter: decoded.resumeAfter })
						})
					)
				)
		}
	];
};

export const makeReferenceProductLayer = (options: ReferenceProductOptions) => {
	const graphqlLayer = makeProductGraphqlLayer({
		registrations: [
			{ policy: listPolicy, document: REFERENCE_PROJECTS_DOCUMENT },
			{ policy: archivePolicy, document: REFERENCE_ARCHIVE_DOCUMENT }
		],
		...(options.fetch === undefined ? {} : { fetch: options.fetch }),
		...(options.credentialHeaders === undefined
			? {}
			: { credentialHeaders: options.credentialHeaders })
	});
	const brokerLayer = makeProductCapabilityBrokerLayer({ manifests });
	const eventsLayer = makeProductEventsLayer({
		policies: [eventPolicy],
		connectors: new Map([[eventPolicy.id, options.eventConnector]])
	});
	const registries = Layer.unwrap(
		Effect.gen(function* () {
			const graphql = yield* ProductGraphql;
			const unary = makeProductCapabilityRegistryLayer({
				operations: makeUnaryDefinitions(options, graphql)
			}).pipe(Layer.provide(brokerLayer));
			const subscriptions = makeProductEventRegistryLayer({
				operations: makeEventDefinitions(options)
			}).pipe(Layer.provide(Layer.merge(brokerLayer, eventsLayer)));
			return Layer.merge(unary, subscriptions);
		}).pipe(Effect.provide(graphqlLayer))
	);
	const configuration = Layer.succeed(ReferenceProductConfiguration)({
		inferenceOwner: options.inferenceOwner ?? 'user'
	});
	return Layer.merge(registries, configuration);
};
