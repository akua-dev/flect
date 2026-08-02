// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultInterfaceDocument,
  InterfaceDocument,
} from "../../shared/interface-document";
import { InterfaceRenderer } from "./interface-renderer";

afterEach(cleanup);

describe("InterfaceRenderer", () => {
  it("renders the trusted component document with semantic controls", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();

    render(
      <InterfaceRenderer
        document={defaultInterfaceDocument}
        onAction={onAction}
        renderPrompt={(node) => (
          <label>
            Prompt
            <textarea placeholder={node.placeholder} />
          </label>
        )}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "What should we shape?" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveAttribute(
      "placeholder",
      "Build, change, or connect anything",
    );

    await user.click(screen.getByRole("button", { name: "Shape interface" }));
    expect(onAction).toHaveBeenCalledWith("shape");
  });

  it("renders product surfaces only through the protected injection point", () => {
    const document = InterfaceDocument.make({
      version: 2,
      name: "Outreach",
      root: {
        id: "outreach-review",
        type: "product-surface",
        capabilityId: "akua-outreach-review",
        title: "Outreach Review",
      },
    });
    const { rerender } = render(
      <InterfaceRenderer
        document={document}
        onAction={() => undefined}
        renderPrompt={() => null}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Outreach Review" }),
    ).toHaveTextContent("unavailable");

    rerender(
      <InterfaceRenderer
        document={document}
        onAction={() => undefined}
        renderPrompt={() => null}
        renderProductSurface={(node) => <div>{node.capabilityId}</div>}
      />,
    );
    expect(screen.getByText("akua-outreach-review")).toBeVisible();
  });
});
