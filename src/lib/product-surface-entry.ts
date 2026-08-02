import { Option, Schema } from "effect";
import { InterfaceDocument } from "../../shared/interface-document";
import {
  ProductSurfaceCapabilityId,
  type ProductSurfaceSummary,
} from "../../shared/product-surface";

export function productSurfaceCapabilityFromSearch(
  search: string,
  safeMode: boolean,
): string | undefined {
  if (safeMode) return undefined;
  const parameters = new URLSearchParams(search);
  const values = parameters.getAll("surface");
  if (values.length !== 1) return undefined;
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(ProductSurfaceCapabilityId)(values[0]),
  );
}

export function productSurfaceDocument(
  summary: ProductSurfaceSummary,
): InterfaceDocument {
  return InterfaceDocument.make({
    version: 2,
    name: summary.title,
    root: {
      id: "local-product",
      type: "product-surface",
      capabilityId: summary.capabilityId,
      title: summary.title,
    },
  });
}
