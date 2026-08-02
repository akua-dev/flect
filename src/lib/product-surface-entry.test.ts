import { describe, expect, it } from "vitest";
import { ProductSurfaceSummary } from "../../shared/product-surface";
import {
  productSurfaceCapabilityFromSearch,
  productSurfaceDocument,
} from "./product-surface-entry";

describe("product surface entry", () => {
  it("accepts one non-secret capability and ignores it in safe mode", () => {
    expect(
      productSurfaceCapabilityFromSearch(
        "?surface=akua-outreach-review",
        false,
      ),
    ).toBe("akua-outreach-review");
    expect(
      productSurfaceCapabilityFromSearch("?surface=akua-outreach-review", true),
    ).toBeUndefined();
  });

  it("rejects duplicate, malformed, and secret-like launch values", () => {
    expect(
      productSurfaceCapabilityFromSearch("?surface=a&surface=b", false),
    ).toBeUndefined();
    expect(
      productSurfaceCapabilityFromSearch("?surface=../../secret", false),
    ).toBeUndefined();
    expect(
      productSurfaceCapabilityFromSearch("?surface=token%3Dsecret", false),
    ).toBeUndefined();
  });

  it("uses only the redacted registry summary to construct the document", () => {
    const document = productSurfaceDocument(
      ProductSurfaceSummary.make({
        version: 1,
        capabilityId: "akua-outreach-review",
        title: "Outreach Review",
        origin: "http://127.0.0.1:3211",
        status: "pending",
        expiresAt: "2099-08-02T12:00:00.000Z",
      }),
    );
    expect(document).toEqual({
      version: 2,
      name: "Outreach Review",
      root: {
        id: "local-product",
        type: "product-surface",
        capabilityId: "akua-outreach-review",
        title: "Outreach Review",
      },
    });
    expect(JSON.stringify(document)).not.toContain("credential");
  });
});
