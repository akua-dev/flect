import { Schema } from 'effect';
import { ProductAdapterJson, ProductAdapterPolicyId } from './product-adapter.js';
import { ProductOperationId } from './product-capability.js';

export const ProductEventSequence = Schema.String.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(39),
	Schema.isPattern(/^(0|[1-9][0-9]{0,38})$/)
);

export class ProductEventPolicy extends Schema.Class<ProductEventPolicy>('ProductEventPolicy')({
	version: Schema.Literal(1),
	id: ProductAdapterPolicyId,
	operationId: ProductOperationId,
	bufferCapacity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 256 })),
	eventBytes: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1024 * 1024 })),
	reconnectAttempts: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })),
	reconnectDelayMs: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 60_000 })),
	sequenceResume: Schema.Boolean
}) {}

export class ProductEventRequest extends Schema.Class<ProductEventRequest>('ProductEventRequest')({
	version: Schema.Literal(1),
	policyId: ProductAdapterPolicyId,
	input: ProductAdapterJson,
	resumeAfter: Schema.optionalKey(ProductEventSequence)
}) {}

export class ProductEvent extends Schema.Class<ProductEvent>('ProductEvent')({
	version: Schema.Literal(1),
	policyId: ProductAdapterPolicyId,
	sequence: ProductEventSequence,
	payload: ProductAdapterJson
}) {}

export class ProductEventFailure extends Schema.TaggedErrorClass<ProductEventFailure>()(
	'ProductEventFailure',
	{
		policyId: ProductAdapterPolicyId,
		reason: Schema.Literals([
			'invalid-policy',
			'denied',
			'invalid-event',
			'overflow',
			'sequence-violation',
			'transport',
			'reconnect-exhausted',
			'revoked'
		]),
		message: Schema.Literal('The product event stream failed safely.')
	}
) {}
