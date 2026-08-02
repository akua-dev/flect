import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProductSurfaceRevoked,
  ProductSurfaceSummary,
  ResolvedProductSurface,
} from "../../shared/product-surface";
import { FlectClient, ProductSurfaceHostUnavailable } from "../lib/api";
import { browserRuntime } from "../lib/runtime";

export interface ProductSurfaceOperations {
  readonly summary: (capabilityId: string) => Promise<ProductSurfaceSummary>;
  readonly approve: (capabilityId: string) => Promise<ProductSurfaceSummary>;
  readonly resolve: (capabilityId: string) => Promise<ResolvedProductSurface>;
  readonly revoke: (capabilityId: string) => Promise<ProductSurfaceRevoked>;
}

const liveOperations: ProductSurfaceOperations = {
  summary: (capabilityId) =>
    browserRuntime.runPromise(
      FlectClient.use((client) => client.productSurfaceSummary(capabilityId)),
    ),
  approve: (capabilityId) =>
    browserRuntime.runPromise(
      FlectClient.use((client) => client.approveProductSurface(capabilityId)),
    ),
  resolve: (capabilityId) =>
    browserRuntime.runPromise(
      FlectClient.use((client) => client.resolveProductSurface(capabilityId)),
    ),
  revoke: (capabilityId) =>
    browserRuntime.runPromise(
      FlectClient.use((client) => client.revokeProductSurface(capabilityId)),
    ),
};

export type ProductSurfaceState =
  | { readonly type: "loading" }
  | { readonly type: "pending"; readonly summary: ProductSurfaceSummary }
  | { readonly type: "granting"; readonly summary: ProductSurfaceSummary }
  | { readonly type: "granted"; readonly resolved: ResolvedProductSurface }
  | { readonly type: "revoking" }
  | { readonly type: "expired" }
  | { readonly type: "unavailable" }
  | { readonly type: "error" };

const failedState = (error: unknown): ProductSurfaceState =>
  error instanceof ProductSurfaceHostUnavailable && error.reason === "expired"
    ? { type: "expired" }
    : error instanceof ProductSurfaceHostUnavailable &&
        (error.reason === "not-found" || error.reason === "unavailable")
      ? { type: "unavailable" }
      : { type: "error" };

export function useProductSurface(options: {
  capabilityId: string;
  enabled: boolean;
  operations?: ProductSurfaceOperations;
}) {
  const operations = options.operations ?? liveOperations;
  const [state, setState] = useState<ProductSurfaceState>({ type: "loading" });
  const resolvedRef = useRef<ResolvedProductSurface | undefined>(undefined);

  useEffect(() => {
    let active = true;
    resolvedRef.current = undefined;
    if (!options.enabled) {
      setState({ type: "unavailable" });
      return () => {
        active = false;
        resolvedRef.current = undefined;
      };
    }
    setState({ type: "loading" });
    void operations
      .summary(options.capabilityId)
      .then(async (summary) => {
        if (!active) return;
        if (Date.parse(summary.expiresAt) <= Date.now()) {
          setState({ type: "expired" });
          return;
        }
        if (summary.status === "pending") {
          setState({ type: "pending", summary });
          return;
        }
        const resolved = await operations.resolve(options.capabilityId);
        if (active) {
          resolvedRef.current = resolved;
          setState({ type: "granted", resolved });
        }
      })
      .catch((error: unknown) => {
        if (active) setState(failedState(error));
      });
    return () => {
      active = false;
      resolvedRef.current = undefined;
    };
  }, [operations, options.capabilityId, options.enabled]);

  const grant = useCallback(async () => {
    if (state.type !== "pending") return;
    setState({ type: "granting", summary: state.summary });
    try {
      await operations.approve(options.capabilityId);
      const resolved = await operations.resolve(options.capabilityId);
      resolvedRef.current = resolved;
      setState({ type: "granted", resolved });
    } catch (error) {
      resolvedRef.current = undefined;
      setState(failedState(error));
    }
  }, [operations, options.capabilityId, state]);

  const revoke = useCallback(async () => {
    if (state.type === "loading" || state.type === "revoking") return;
    resolvedRef.current = undefined;
    setState({ type: "revoking" });
    try {
      await operations.revoke(options.capabilityId);
      setState({ type: "unavailable" });
    } catch {
      setState({ type: "error" });
    }
  }, [operations, options.capabilityId, state.type]);

  return { state, grant, revoke };
}
