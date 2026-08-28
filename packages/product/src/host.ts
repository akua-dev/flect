// Re-exports the Effect `Schema` namespace alongside the host modules below
// so a `@flect/product/host` consumer can express
// `Schema.Schema.Type<typeof SomeHostContract>` without a second import —
// every module this barrel aggregates is defined with Effect Schema.
export type { Schema } from 'effect';
export * from './host/product-events.js';
export * from './host/product-graphql.js';
export * from './host/product-http.js';
export * from './host/share-source.js';
