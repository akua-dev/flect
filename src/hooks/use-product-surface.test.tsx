// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  ProductSurfaceRevoked,
  ProductSurfaceSummary,
  ResolvedProductSurface,
} from "../../shared/product-surface";
import {
  type ProductSurfaceOperations,
  useProductSurface,
} from "./use-product-surface";

const summary = ProductSurfaceSummary.make({
  version: 1,
  capabilityId: "akua-outreach-review",
  title: "Outreach Review",
  origin: "http://127.0.0.1:3211",
  status: "pending",
  expiresAt: "2099-08-02T12:00:00.000Z",
});

const resolved = ResolvedProductSurface.make({
  version: 1,
  capabilityId: "akua-outreach-review",
  title: "Outreach Review",
  origin: "http://127.0.0.1:3211",
  entryPath: "/?embed=1",
  sessionCredential: "a-local-session-secret",
});

const operations = (overrides: Partial<ProductSurfaceOperations> = {}) => ({
  summary: vi.fn(() => Promise.resolve(summary)),
  approve: vi.fn(() =>
    Promise.resolve(
      ProductSurfaceSummary.make({ ...summary, status: "granted" }),
    ),
  ),
  resolve: vi.fn(() => Promise.resolve(resolved)),
  revoke: vi.fn(() =>
    Promise.resolve(
      ProductSurfaceRevoked.make({
        version: 1,
        capabilityId: "akua-outreach-review",
        status: "revoked",
      }),
    ),
  ),
  ...overrides,
});

describe("useProductSurface", () => {
  it("never resolves before one explicit grant", async () => {
    const client = operations();
    const result = renderHook(() =>
      useProductSurface({
        capabilityId: "akua-outreach-review",
        enabled: true,
        operations: client,
      }),
    );
    await waitFor(() =>
      expect(result.result.current.state.type).toBe("pending"),
    );
    expect(client.resolve).not.toHaveBeenCalled();

    await act(() => result.result.current.grant());
    expect(client.approve).toHaveBeenCalledTimes(1);
    expect(client.resolve).toHaveBeenCalledTimes(1);
    expect(result.result.current.state.type).toBe("granted");
  });

  it("clears the granted state before revocation completes", async () => {
    const deferred = Effect.runSync(Deferred.make<ProductSurfaceRevoked>());
    const client = operations({
      summary: vi.fn(() =>
        Promise.resolve(
          ProductSurfaceSummary.make({ ...summary, status: "granted" }),
        ),
      ),
      revoke: vi.fn(() => Effect.runPromise(Deferred.await(deferred))),
    });
    const result = renderHook(() =>
      useProductSurface({
        capabilityId: "akua-outreach-review",
        enabled: true,
        operations: client,
      }),
    );
    await waitFor(() =>
      expect(result.result.current.state.type).toBe("granted"),
    );

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.result.current.revoke();
    });
    expect(result.result.current.state.type).toBe("revoking");
    Effect.runSync(
      Deferred.succeed(
        deferred,
        ProductSurfaceRevoked.make({
          version: 1,
          capabilityId: "akua-outreach-review",
          status: "revoked",
        }),
      ),
    );
    await act(() => pending);
    expect(result.result.current.state.type).toBe("unavailable");
  });

  it("does not contact the host when disabled", () => {
    const client = operations();
    const result = renderHook(() =>
      useProductSurface({
        capabilityId: "akua-outreach-review",
        enabled: false,
        operations: client,
      }),
    );
    expect(result.result.current.state.type).toBe("unavailable");
    expect(client.summary).not.toHaveBeenCalled();
  });
});
