// Re-exports the Effect `Schema` namespace alongside the contract modules
// below so a `@flect/product/contracts` consumer can express
// `Schema.Schema.Type<typeof SomeContract>` without a second import — every
// contract this barrel aggregates is defined with Effect Schema.
export type { Schema } from 'effect';
export * from './adoption.js';
export * from './capsule.js';
export * from './extensions.js';
export * from './integration.js';
export * from './product-adapter.js';
export * from './product-capability.js';
export * from './product-events.js';
export * from './product-graphql.js';
export * from './product-http.js';
export * from './share.js';
