// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentProductActionRequest,
  ProductActionResult,
} from "../../shared/product-action";
import {
  ProductSurfaceRevoked,
  ProductSurfaceSummary,
  ResolvedProductSurface,
} from "../../shared/product-surface";
import type { ProductSurfaceOperations } from "../hooks/use-product-surface";
import { ProductSurface } from "./product-surface";

afterEach(cleanup);

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
  agentActionPath: "/api/agent-actions",
  sessionCredential: "a-local-session-secret",
});

const controller = (overrides: Partial<ProductSurfaceOperations> = {}) => ({
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

const node = {
  id: "surface",
  type: "product-surface" as const,
  capabilityId: "akua-outreach-review",
  title: "Outreach Review",
};

describe("ProductSurface", () => {
  it("requires an explicit grant before mounting the iframe", async () => {
    const user = userEvent.setup();
    const controls = controller();
    render(<ProductSurface operations={controls} enabled node={node} />);

    expect(await screen.findByText("Allow local product")).toBeVisible();
    expect(screen.getByText("http://127.0.0.1:3211")).toBeVisible();
    expect(screen.queryByTitle("Outreach Review")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Allow local product" }),
    );
    const frame = await screen.findByTitle("Outreach Review");
    expect(frame).toHaveAttribute("src", "http://127.0.0.1:3211/?embed=1");
    expect(frame).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-forms allow-same-origin",
    );
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveAttribute("credentialless");
    expect(frame).toHaveAttribute("allow", "");
    expect(document.body.textContent).not.toContain("a-local-session-secret");
  });

  it("releases the credential only after load and to the exact granted origin", async () => {
    const controls = controller({
      summary: vi.fn(() =>
        Promise.resolve(
          ProductSurfaceSummary.make({ ...summary, status: "granted" }),
        ),
      ),
    });
    render(<ProductSurface operations={controls} enabled node={node} />);
    const frame =
      await screen.findByTitle<HTMLIFrameElement>("Outreach Review");
    const contentWindow = frame.contentWindow;
    expect(contentWindow).not.toBeNull();
    if (contentWindow === null) throw new Error("iframe window is unavailable");
    const postMessage = vi.spyOn(contentWindow, "postMessage");

    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.load(frame);
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "product-surface-capability",
        credential: "a-local-session-secret",
      }),
      "http://127.0.0.1:3211",
    );
  });

  it("never resolves or mounts a surface in safe mode", () => {
    const controls = controller();
    render(
      <ProductSurface operations={controls} enabled={false} node={node} />,
    );
    expect(controls.summary).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Outreach Review")).not.toBeInTheDocument();
    expect(document.body.firstElementChild).toBeEmptyDOMElement();
  });

  it("returns read-only product actions without showing confirmation", async () => {
    const controls = controller({
      summary: vi.fn(() =>
        Promise.resolve(
          ProductSurfaceSummary.make({ ...summary, status: "granted" }),
        ),
      ),
    });
    const pending: AgentProductActionRequest = {
      type: "product_action_request",
      requestId: "action-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
      capabilityId: "akua-outreach-review",
      action: "inspect",
      inputJson: "{}",
    };
    const complete = vi.fn(() => Promise.resolve());
    const deny = vi.fn(() => Promise.resolve());
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 1,
          effect: "read",
          title: "Current outreach review",
          resultJson: '{"company":"Documenso"}',
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(
      <ProductSurface
        actionFetcher={fetcher}
        enabled
        node={node}
        operations={controls}
        productAction={{ pending, complete, deny }}
      />,
    );

    await waitFor(() =>
      expect(complete).toHaveBeenCalledWith(
        ProductActionResult.make({
          version: 1,
          status: "ok",
          resultJson: '{"company":"Documenso"}',
        }),
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Confirm" }),
    ).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:3211/api/agent-actions/prepare",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer a-local-session-secret",
        }),
      }),
    );
  });

  it("confirms one exact write before execution and refreshes the iframe", async () => {
    const user = userEvent.setup();
    const controls = controller({
      summary: vi.fn(() =>
        Promise.resolve(
          ProductSurfaceSummary.make({ ...summary, status: "granted" }),
        ),
      ),
    });
    const pending: AgentProductActionRequest = {
      type: "product_action_request",
      requestId: "action-018f8f4f-76d1-7f4d-8f35-71eebc5931d2",
      capabilityId: "akua-outreach-review",
      action: "select_candidate",
      inputJson:
        '{"conversationKey":"documenso.com|founder|email","angle":"D","expectedLifecycleRevision":1}',
    };
    const complete = vi.fn(() => Promise.resolve());
    const deny = vi.fn(() => Promise.resolve());
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            effect: "write",
            title: "Select draft D",
            summary: "Make draft D the immutable V1 for the verified founder.",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            version: 1,
            effect: "written",
            title: "Draft D selected",
            resultJson: '{"selectedAngle":"D"}',
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    render(
      <ProductSurface
        actionFetcher={fetcher}
        enabled
        node={node}
        operations={controls}
        productAction={{ pending, complete, deny }}
      />,
    );
    const frame =
      await screen.findByTitle<HTMLIFrameElement>("Outreach Review");
    const contentWindow = frame.contentWindow;
    if (contentWindow === null) throw new Error("iframe window is unavailable");
    const postMessage = vi.spyOn(contentWindow, "postMessage");

    expect(await screen.findByText("Select draft D")).toBeVisible();
    expect(
      screen.getByText(
        "Make draft D the immutable V1 for the verified founder.",
      ),
    ).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(complete).toHaveBeenCalledWith(
      ProductActionResult.make({
        version: 1,
        status: "ok",
        resultJson: '{"selectedAngle":"D"}',
      }),
    );
    expect(postMessage).toHaveBeenCalledWith(
      {
        version: 1,
        type: "product-surface-refresh",
        capabilityId: "akua-outreach-review",
      },
      "http://127.0.0.1:3211",
    );
  });
});
