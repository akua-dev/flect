import { Schema } from 'effect';

export const MAX_PRODUCT_ADAPTER_JSON_BYTES = 1024 * 1024;

export const ProductAdapterPolicyId = Schema.String.check(
	Schema.isMinLength(3),
	Schema.isMaxLength(120),
	Schema.isPattern(/^[a-z][a-z0-9.-]*$/)
);

export const ProductAdapterJson = Schema.Json.check(
	Schema.makeFilter(
		(value) =>
			new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_PRODUCT_ADAPTER_JSON_BYTES,
		{ expected: 'JSON no larger than one MiB' }
	)
);
