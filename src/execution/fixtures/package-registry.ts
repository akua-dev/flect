import type { Fetcher, Packument } from "@riftydev/npm-client";

const TARBALL_BASE64 =
  "H4sIAAAAAAACE+3TsQ7CIBAGYGafomFWSmvVROPDkPZq0BYaoKaJ8d09q8ZEBxdtot63/HAMDPA3Kt+pDcTNJcXWW8PeTKJ5lvWJHlPKxey+7udJMp9isgG0PiiHV7L/dOBG1cCXvKwgD5NSd6F1wMd8D85ra/AkEVJInNRKn7faFNDhP+HHESPf7tr7+Paqn7jjZf/T5/7jkPo/gNoWbQUCusa64KN1lKUr6jUhhPy+E9y6GJgADAAA";
const TARBALL_URL =
  "https://registry.flect.invalid/flect-fixture/-/flect-fixture-1.0.0.tgz";
const INTEGRITY =
  "sha512-UtEKTNiX8Hl8pY4rXAeaqQIn4FoI6bXsJB/osrIJ7KjLdJp1P+VT+cjo25gH2I/4dtASAlzkzJJBkCD48sKulQ==";
const TRAVERSAL_TARBALL_BASE64 =
  "H4sIAAAAAAAAEytITM5OTE/V19ODouKiZP2C8jy9kmIGWgMDODBFEzcytzBjUDCguQtGQX55XmrKaDAwjFQAAKekiwMABAAA";
const TRAVERSAL_TARBALL_URL =
  "https://registry.flect.invalid/flect-fixture/-/flect-fixture-traversal.tgz";
const TRAVERSAL_INTEGRITY =
  "sha512-L1cy1eehr7wsk+ZGBG9p5Thn84TcX0RB/JdZEcklZO4iaSqbVxOTBAQJd3nZX4878fJ7aTPPzHqALTprG24/Hw==";

const tarball = Uint8Array.from(atob(TARBALL_BASE64), (character) =>
  character.charCodeAt(0),
);

const makePackument = (
  integrity: string,
  tarball = TARBALL_URL,
): Packument => ({
  name: "flect-fixture",
  "dist-tags": { latest: "1.0.0" },
  versions: {
    "1.0.0": {
      name: "flect-fixture",
      version: "1.0.0",
      dist: {
        tarball,
        integrity,
      },
    },
  },
});

const makeRegistryFetch =
  (integrity: string): Fetcher =>
  (url) => {
    if (url === "https://registry.flect.invalid/flect-fixture") {
      return Promise.resolve(Response.json(makePackument(integrity)));
    }

    if (url === TARBALL_URL) {
      return Promise.resolve(
        new Response(tarball, {
          headers: { "content-type": "application/octet-stream" },
        }),
      );
    }

    return Promise.reject(
      new Error("Fixture registry rejected an unknown URL."),
    );
  };

export const fixtureRegistryFetch = makeRegistryFetch(INTEGRITY);
export const badIntegrityRegistryFetch = makeRegistryFetch("sha512-invalid");

export const traversalRegistryFetch: Fetcher = (url) => {
  if (url === "https://registry.flect.invalid/flect-fixture") {
    return Promise.resolve(
      Response.json(makePackument(TRAVERSAL_INTEGRITY, TRAVERSAL_TARBALL_URL)),
    );
  }
  if (url === TRAVERSAL_TARBALL_URL) {
    const bytes = Uint8Array.from(atob(TRAVERSAL_TARBALL_BASE64), (character) =>
      character.charCodeAt(0),
    );
    return Promise.resolve(
      new Response(bytes, {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
  }
  return Promise.reject(new Error("Traversal fixture rejected an unknown URL."));
};
