import type { ProductOperationDefinition } from '@flect/product';
import { Effect } from 'effect';
import type {
	NativeAccentColor,
	NativePlatformCapabilityFailure
} from '../../shared/native-platform';
import {
	AuthorizedProductOperation,
	ProductCapabilityManifest
} from '../../shared/product-capability';
import { productOperationFailure } from './product-operation-failure';

export const NativeAppearanceCapabilityManifest = ProductCapabilityManifest.make({
	version: 1,
	id: 'product:native-appearance:read',
	name: 'Read native appearance',
	description: 'Read the current operating-system accent color.',
	operationIds: ['native.appearance.current'],
	resourceIds: ['native.appearance'],
	dataClassIds: ['appearance.accent'],
	confirmationPolicies: ['once', 'session', 'workspace'],
	maxGrantDurationMs: 86_400_000,
	maxRate: { maxInvocations: 30, intervalMs: 60_000 }
});

export const makeNativeAppearanceOperation = (
	systemAccentColor: Effect.Effect<NativeAccentColor, NativePlatformCapabilityFailure>
): ProductOperationDefinition => ({
	id: 'native.appearance.current',
	capabilityId: NativeAppearanceCapabilityManifest.id,
	authorize: (input) =>
		input === null ||
		(typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0)
			? Effect.succeed(
					AuthorizedProductOperation.make({
						version: 1,
						capabilityId: NativeAppearanceCapabilityManifest.id,
						operationId: 'native.appearance.current',
						resourceIds: ['native.appearance'],
						dataClassIds: ['appearance.accent']
					})
				)
			: Effect.fail(productOperationFailure('native.appearance.current', 'invalid-input')),
	execute: () =>
		systemAccentColor.pipe(
			Effect.map((accent) => ({ ...accent })),
			Effect.mapError(() => productOperationFailure('native.appearance.current', 'unavailable'))
		)
});
