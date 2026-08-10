// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installFlectActivation,
  shouldActivateFlectImmediately,
} from "./activate-flect";

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-flect-state");
});

const shell = () => {
  document.body.innerHTML = `
    <main id="flect-static-shell">
      <form data-flect-starter>
        <textarea data-flect-activate name="prompt"></textarea>
        <button data-flect-activate>Send to Flect</button>
      </form>
      <p id="flect-activation-status">Ready</p>
    </main>
    <div id="root" hidden></div>
  `;
};

describe("Flect activation boundary", () => {
  it("keeps an ordinary browser view static until the user activates it", async () => {
    shell();
    const mountFlect = vi.fn(() => Promise.resolve());
    const load = vi.fn(() => Promise.resolve({ mountFlect }));
    const activation = installFlectActivation({
      document,
      location: {
        href: "https://flect.local/?view=1",
        hostname: "flect.local",
        protocol: "https:",
      },
      testMode: true,
      desktop: false,
      load,
    });

    expect(activation.immediate).toBe(false);
    expect(load).not.toHaveBeenCalled();
    const activationTarget = document.querySelector("[data-flect-activate]");
    expect(activationTarget).not.toBeNull();
    if (activationTarget === null) return;
    fireEvent.focusIn(activationTarget);
    await activation.activate();

    expect(load).toHaveBeenCalledOnce();
    expect(mountFlect).toHaveBeenCalledWith(document.getElementById("root"));
    expect(document.getElementById("root")).toHaveAttribute("hidden");
    expect(document.getElementById("flect-static-shell")).not.toHaveAttribute(
      "hidden",
    );
  });

  it("hands a starter prompt to the activated client without navigation", async () => {
    shell();
    const mountFlect = vi.fn(() => Promise.resolve());
    const load = vi.fn(() => Promise.resolve({ mountFlect }));
    installFlectActivation({
      document,
      location: {
        href: "https://flect.local/?view=1",
        hostname: "flect.local",
        protocol: "https:",
      },
      testMode: false,
      desktop: false,
      load,
    });
    const prompt = document.querySelector("textarea");
    const form = document.querySelector("form");
    expect(prompt).not.toBeNull();
    expect(form).not.toBeNull();
    if (prompt === null || form === null) return;
    fireEvent.change(prompt, { target: { value: "Make a calm notes app" } });
    const submitted = new Promise<string>((resolve) => {
      document.addEventListener(
        "flect:starter-submit",
        (event) => {
          const detail: unknown = (event as CustomEvent).detail;
          resolve(String(Reflect.get(detail as object, "prompt")));
        },
        { once: true },
      );
    });
    fireEvent.submit(form);
    expect(await submitted).toBe("Make a calm notes app");
  });

  it.each([
    ["test", { href: "https://flect.local/", testMode: true, desktop: false }],
    ["desktop", { href: "tauri://localhost/", testMode: false, desktop: true }],
    [
      "safe mode",
      { href: "https://flect.local/?safe=1", testMode: false, desktop: false },
    ],
    [
      "diagnostic",
      {
        href: "https://flect.local/?git-diagnostic=1",
        testMode: false,
        desktop: false,
      },
    ],
  ] as const)("activates immediately for %s", (_label, input) => {
    expect(shouldActivateFlectImmediately(input)).toBe(true);
  });
});
