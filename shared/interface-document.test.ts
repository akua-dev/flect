import { describe, expect, it } from "vitest";
import {
  defaultInterfaceDocument,
  parseInterfaceDocument,
} from "./interface-document";

describe("parseInterfaceDocument", () => {
  it("falls back for malformed JSON", () => {
    expect(parseInterfaceDocument("{bad json")).toBe(defaultInterfaceDocument);
  });

  it("falls back for unsupported versions", () => {
    expect(
      parseInterfaceDocument(
        JSON.stringify({
          version: 2,
          headline: "Replace the protected core",
          placeholder: "Unsafe",
          secondaryActions: [],
        }),
      ),
    ).toBe(defaultInterfaceDocument);
  });

  it("falls back for unrecognized actions", () => {
    expect(
      parseInterfaceDocument(
        JSON.stringify({
          version: 1,
          headline: "What should we shape?",
          placeholder: "Build anything",
          secondaryActions: ["run-code"],
        }),
      ),
    ).toBe(defaultInterfaceDocument);
  });

  it("accepts a valid version-one document", () => {
    const document = {
      version: 1 as const,
      headline: "Where should we begin?",
      placeholder: "Describe an interface",
      secondaryActions: ["open", "connect"] as const,
    };

    expect(parseInterfaceDocument(JSON.stringify(document))).toEqual(document);
  });

  it("returns the built-in document when no stored state exists", () => {
    expect(parseInterfaceDocument(null)).toBe(defaultInterfaceDocument);
  });
});
