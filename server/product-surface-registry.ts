import { Clock, Context, Effect, Layer, Ref, Schema } from "effect";
import {
  type ProductSurfaceRegistration,
  ProductSurfaceRevoked,
  ProductSurfaceSummary,
  ResolvedProductSurface,
} from "../shared/product-surface";

export class ProductSurfaceRegistryError extends Schema.TaggedErrorClass<ProductSurfaceRegistryError>()(
  "ProductSurfaceRegistryError",
  {
    code: Schema.Literals(["not-found", "pending", "expired", "conflict"]),
    message: Schema.String,
  },
) {}

interface StoredProductSurface {
  readonly registration: ProductSurfaceRegistration;
  readonly status: "pending" | "granted";
}

export interface ProductSurfaceRegistryShape {
  readonly register: (
    registration: ProductSurfaceRegistration,
  ) => Effect.Effect<ProductSurfaceSummary, ProductSurfaceRegistryError>;
  readonly getSummary: (
    capabilityId: string,
  ) => Effect.Effect<ProductSurfaceSummary, ProductSurfaceRegistryError>;
  readonly approve: (
    capabilityId: string,
  ) => Effect.Effect<ProductSurfaceSummary, ProductSurfaceRegistryError>;
  readonly resolve: (
    capabilityId: string,
  ) => Effect.Effect<ResolvedProductSurface, ProductSurfaceRegistryError>;
  readonly revoke: (
    capabilityId: string,
  ) => Effect.Effect<ProductSurfaceRevoked, ProductSurfaceRegistryError>;
}

export class ProductSurfaceRegistry extends Context.Service<
  ProductSurfaceRegistry,
  ProductSurfaceRegistryShape
>()("flect/server/ProductSurfaceRegistry") {}

const registryError = (
  code: "not-found" | "pending" | "expired" | "conflict",
  message: string,
) => ProductSurfaceRegistryError.make({ code, message });

const summary = (stored: StoredProductSurface) =>
  ProductSurfaceSummary.make({
    version: 1,
    capabilityId: stored.registration.capabilityId,
    title: stored.registration.title,
    origin: stored.registration.origin,
    status: stored.status,
    expiresAt: stored.registration.expiresAt,
  });

const sameRegistration = (
  left: ProductSurfaceRegistration,
  right: ProductSurfaceRegistration,
) =>
  left.version === right.version &&
  left.capabilityId === right.capabilityId &&
  left.title === right.title &&
  left.origin === right.origin &&
  left.entryPath === right.entryPath &&
  left.agentActionPath === right.agentActionPath &&
  left.sessionCredential === right.sessionCredential &&
  left.expiresAt === right.expiresAt;

const sameEndpoint = (
  left: ProductSurfaceRegistration,
  right: ProductSurfaceRegistration,
) =>
  left.version === right.version &&
  left.capabilityId === right.capabilityId &&
  left.title === right.title &&
  left.origin === right.origin &&
  left.entryPath === right.entryPath &&
  left.agentActionPath === right.agentActionPath;

type LookupResult =
  | { readonly type: "found"; readonly stored: StoredProductSurface }
  | { readonly type: "missing" }
  | { readonly type: "expired" };

export const ProductSurfaceRegistryLive = Layer.effect(
  ProductSurfaceRegistry,
  Effect.gen(function* () {
    const state = yield* Ref.make(new Map<string, StoredProductSurface>());

    const lookup = Effect.fn("Flect.ProductSurfaceRegistry.lookup")(function* (
      capabilityId: string,
    ) {
      const now = yield* Clock.currentTimeMillis;
      return yield* Ref.modify(
        state,
        (
          current,
        ): readonly [LookupResult, Map<string, StoredProductSurface>] => {
          const stored = current.get(capabilityId);
          if (stored === undefined) return [{ type: "missing" }, current];
          if (Date.parse(stored.registration.expiresAt) <= now) {
            const next = new Map(current);
            next.delete(capabilityId);
            return [{ type: "expired" }, next];
          }
          return [{ type: "found", stored }, current];
        },
      );
    });

    const requireStored = Effect.fn("Flect.ProductSurfaceRegistry.require")(
      function* (capabilityId: string) {
        const result = yield* lookup(capabilityId);
        if (result.type === "found") return result.stored;
        return yield* Effect.fail(
          result.type === "expired"
            ? registryError("expired", "The product surface grant expired.")
            : registryError("not-found", "The product surface is unavailable."),
        );
      },
    );

    const register = Effect.fn("Flect.ProductSurfaceRegistry.register")(
      function* (registration: ProductSurfaceRegistration) {
        const existing = yield* lookup(registration.capabilityId);
        if (existing.type === "found") {
          if (sameRegistration(existing.stored.registration, registration)) {
            return summary(existing.stored);
          }
          if (sameEndpoint(existing.stored.registration, registration)) {
            const replaced: StoredProductSurface = {
              registration,
              status: "pending",
            };
            yield* Ref.update(state, (current) => {
              const next = new Map(current);
              next.set(registration.capabilityId, replaced);
              return next;
            });
            return summary(replaced);
          }
          return yield* Effect.fail(
            registryError(
              "conflict",
              "A different product surface already uses this capability.",
            ),
          );
        }
        const stored: StoredProductSurface = {
          registration,
          status: "pending",
        };
        yield* Ref.update(state, (current) => {
          const next = new Map(current);
          next.set(registration.capabilityId, stored);
          return next;
        });
        return summary(stored);
      },
    );

    const getSummary = Effect.fn("Flect.ProductSurfaceRegistry.getSummary")(
      function* (capabilityId: string) {
        return summary(yield* requireStored(capabilityId));
      },
    );

    const approve = Effect.fn("Flect.ProductSurfaceRegistry.approve")(
      function* (capabilityId: string) {
        const stored = yield* requireStored(capabilityId);
        const approved: StoredProductSurface = { ...stored, status: "granted" };
        yield* Ref.update(state, (current) => {
          const next = new Map(current);
          next.set(capabilityId, approved);
          return next;
        });
        return summary(approved);
      },
    );

    const resolve = Effect.fn("Flect.ProductSurfaceRegistry.resolve")(
      function* (capabilityId: string) {
        const stored = yield* requireStored(capabilityId);
        if (stored.status !== "granted") {
          return yield* Effect.fail(
            registryError(
              "pending",
              "The product surface requires explicit approval.",
            ),
          );
        }
        return ResolvedProductSurface.make({
          version: 1,
          capabilityId,
          title: stored.registration.title,
          origin: stored.registration.origin,
          entryPath: stored.registration.entryPath,
          ...(stored.registration.agentActionPath === undefined
            ? {}
            : { agentActionPath: stored.registration.agentActionPath }),
          sessionCredential: stored.registration.sessionCredential,
        });
      },
    );

    const revoke = Effect.fn("Flect.ProductSurfaceRegistry.revoke")(function* (
      capabilityId: string,
    ) {
      yield* requireStored(capabilityId);
      yield* Ref.update(state, (current) => {
        const next = new Map(current);
        next.delete(capabilityId);
        return next;
      });
      return ProductSurfaceRevoked.make({
        version: 1,
        capabilityId,
        status: "revoked",
      });
    });

    return { register, getSummary, approve, resolve, revoke };
  }),
);
