import type { ProductIntegration } from '@flect/product';
import { Layer } from 'effect';
import type { ProductEvents } from '../../packages/product/src/host/product-events';
import { makeProductCapabilityBrokerLayer } from './product-capability-broker';
import { makeProductCapabilityRegistryLayer } from './product-capability-registry';
import { makeProductEventRegistryLayer } from './product-event-registry';

export interface ProductIntegrationRuntimeOptions<EventsError, EventsRequirements> {
	readonly integration: ProductIntegration;
	readonly events: Layer.Layer<ProductEvents, EventsError, EventsRequirements>;
}

/**
 * Joins a validated public product integration to Flect's private capability
 * broker. Public product code supplies narrow operation and event closures;
 * Flect remains authoritative for grants, revocation, and event reservations.
 */
export const makeProductIntegrationRuntimeLayer = <EventsError, EventsRequirements>(
	options: ProductIntegrationRuntimeOptions<EventsError, EventsRequirements>
) => {
	const broker = makeProductCapabilityBrokerLayer({
		manifests: options.integration.metadata.capabilities
	});
	const dependencies = Layer.merge(broker, options.events);
	const operations = makeProductCapabilityRegistryLayer({
		operations: options.integration.operations
	});
	const subscriptions = makeProductEventRegistryLayer({
		operations: options.integration.events
	});
	return Layer.merge(operations, subscriptions).pipe(Layer.provideMerge(dependencies));
};
