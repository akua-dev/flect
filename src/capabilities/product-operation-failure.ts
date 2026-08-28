import {
	makeProductOperationFailure,
	type ProductCapabilityBrokerFailure,
	type ProductOperationFailure
} from '../../packages/product/src/product-capability';

export const productOperationFailure = (
	operationId: string,
	reason: ProductOperationFailure['reason']
): ProductOperationFailure => makeProductOperationFailure(operationId, reason);

export const productOperationFailureFromBroker = (
	operationId: string,
	error: ProductCapabilityBrokerFailure
) => {
	switch (error.reason) {
		case 'expired':
			return productOperationFailure(operationId, 'expired');
		case 'revoked':
			return productOperationFailure(operationId, 'revoked');
		case 'rate-limited':
			return productOperationFailure(operationId, 'rate-limited');
		case 'unavailable':
			return productOperationFailure(operationId, 'unavailable');
		case 'unknown-capability':
		case 'not-requested':
		case 'invalid-scope':
		case 'persistence-failed':
		case 'denied':
			return productOperationFailure(operationId, 'denied');
	}
};
