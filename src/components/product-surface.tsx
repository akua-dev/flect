import { Schema, type SchemaAST } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductSurfaceNode } from "../../shared/interface-document";
import {
  ProductActionPrepared,
  ProductActionResult,
  type ProductActionWritePrepared,
  ProductActionWritten,
} from "../../shared/product-action";
import { ProductSurfaceCapabilityMessage } from "../../shared/product-surface";
import type { ProductActionController } from "../hooks/use-agent-session";
import {
  type ProductSurfaceOperations,
  useProductSurface,
} from "../hooks/use-product-surface";

export interface ProductSurfaceProps {
  readonly node: ProductSurfaceNode;
  readonly enabled: boolean;
  readonly operations?: ProductSurfaceOperations;
  readonly productAction?: ProductActionController;
  readonly actionFetcher?: typeof fetch;
}

const credentiallessFrame = { credentialless: "" } as const;

export function ProductSurface({
  node,
  enabled,
  operations,
  productAction,
  actionFetcher = globalThis.fetch,
}: ProductSurfaceProps) {
  const { state, grant, revoke } = useProductSurface({
    capabilityId: node.capabilityId,
    enabled,
    ...(operations ? { operations } : {}),
  });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handledActionsRef = useRef(new Set<string>());
  const pendingProductAction = productAction?.pending;
  const completeProductAction = productAction?.complete;
  const denyProductAction = productAction?.deny;
  const [confirmation, setConfirmation] = useState<{
    readonly requestId: string;
    readonly body: {
      readonly version: 1;
      readonly action: string;
      readonly input: unknown;
    };
    readonly preview: ProductActionWritePrepared;
  }>();

  useEffect(() => {
    const pending = pendingProductAction;
    if (
      pending === undefined ||
      completeProductAction === undefined ||
      denyProductAction === undefined ||
      handledActionsRef.current.has(pending.requestId) ||
      state.type !== "granted"
    ) {
      return;
    }
    if (pending.capabilityId !== node.capabilityId) {
      handledActionsRef.current.add(pending.requestId);
      void denyProductAction(
        "The product capability did not match the open surface.",
      );
      return;
    }
    if (state.resolved.agentActionPath === undefined) {
      handledActionsRef.current.add(pending.requestId);
      void denyProductAction(
        "This product surface does not expose agent actions.",
      );
      return;
    }

    handledActionsRef.current.add(pending.requestId);
    let active = true;
    void prepareProductAction(
      actionFetcher,
      state.resolved.origin,
      state.resolved.agentActionPath,
      state.resolved.sessionCredential,
      pending.action,
      pending.inputJson,
    )
      .then((prepared) => {
        if (!active) return;
        if (prepared.response.effect === "read") {
          return completeProductAction(
            ProductActionResult.make({
              version: 1,
              status: "ok",
              resultJson: prepared.response.resultJson,
            }),
          );
        }
        setConfirmation({
          requestId: pending.requestId,
          body: prepared.body,
          preview: prepared.response,
        });
      })
      .catch(() => {
        if (!active) return;
        return completeProductAction(
          ProductActionResult.make({
            version: 1,
            status: "error",
            resultJson: JSON.stringify({
              message: "The product action could not be prepared safely.",
            }),
          }),
        );
      });
    return () => {
      active = false;
    };
  }, [
    actionFetcher,
    completeProductAction,
    denyProductAction,
    node.capabilityId,
    pendingProductAction,
    state,
  ]);

  const provideCapability = useCallback(() => {
    if (state.type !== "granted") return;
    iframeRef.current?.contentWindow?.postMessage(
      ProductSurfaceCapabilityMessage.make({
        version: 1,
        type: "product-surface-capability",
        capabilityId: node.capabilityId,
        credential: state.resolved.sessionCredential,
      }),
      state.resolved.origin,
    );
  }, [node.capabilityId, state]);

  const cancelProductAction = useCallback(() => {
    if (confirmation === undefined || productAction === undefined) return;
    handledActionsRef.current.add(confirmation.requestId);
    setConfirmation(undefined);
    void productAction.deny();
  }, [confirmation, productAction]);

  const confirmProductAction = useCallback(async () => {
    if (
      confirmation === undefined ||
      productAction === undefined ||
      state.type !== "granted" ||
      state.resolved.agentActionPath === undefined
    ) {
      return;
    }
    try {
      const executed = await executeProductAction(
        actionFetcher,
        state.resolved.origin,
        state.resolved.agentActionPath,
        state.resolved.sessionCredential,
        confirmation.body,
      );
      handledActionsRef.current.add(confirmation.requestId);
      setConfirmation(undefined);
      await productAction.complete(
        ProductActionResult.make({
          version: 1,
          status: "ok",
          resultJson: executed.resultJson,
        }),
      );
      iframeRef.current?.contentWindow?.postMessage(
        {
          version: 1,
          type: "product-surface-refresh",
          capabilityId: node.capabilityId,
        },
        state.resolved.origin,
      );
    } catch {
      handledActionsRef.current.add(confirmation.requestId);
      setConfirmation(undefined);
      await productAction.complete(
        ProductActionResult.make({
          version: 1,
          status: "error",
          resultJson: JSON.stringify({
            message: "The confirmed product action was not accepted.",
          }),
        }),
      );
    }
  }, [actionFetcher, confirmation, node.capabilityId, productAction, state]);

  if (!enabled) return null;
  if (state.type === "loading" || state.type === "revoking") {
    return (
      <section
        aria-busy="true"
        aria-label={node.title}
        className="product-surface-gate"
      >
        <p>
          {state.type === "revoking"
            ? "Revoking local access"
            : `Opening ${node.title}`}
        </p>
      </section>
    );
  }
  if (
    state.type === "expired" ||
    state.type === "unavailable" ||
    state.type === "error"
  ) {
    return (
      <section aria-label={node.title} className="product-surface-gate">
        <h1>{node.title}</h1>
        <p>
          {state.type === "expired"
            ? "This local product grant expired. Restart its service to register a new session."
            : "The local product surface is unavailable."}
        </p>
      </section>
    );
  }
  if (state.type === "pending" || state.type === "granting") {
    return (
      <section aria-label={node.title} className="product-surface-gate">
        <p className="product-surface-gate__eyebrow">Local product surface</p>
        <h1>{state.summary.title}</h1>
        <p>
          Allow this session from <code>{state.summary.origin}</code> to open
          inside Flect. Access expires at {state.summary.expiresAt}.
        </p>
        <div className="product-surface-gate__actions">
          <button
            disabled={state.type === "granting"}
            onClick={() => void grant()}
            type="button"
          >
            {state.type === "granting" ? "Allowing…" : "Allow local product"}
          </button>
          <button
            className="secondary"
            disabled={state.type === "granting"}
            onClick={() => void revoke()}
            type="button"
          >
            Deny
          </button>
        </div>
      </section>
    );
  }
  return (
    <section aria-label={node.title} className="product-surface-frame">
      <div className="product-surface-frame__bar">
        <span>{state.resolved.title}</span>
        <button onClick={() => void revoke()} type="button">
          Revoke access
        </button>
      </div>
      {confirmation !== undefined && (
        <section
          aria-label="Confirm product action"
          className="product-surface-action"
        >
          <div>
            <strong>{confirmation.preview.title}</strong>
            <p>{confirmation.preview.summary}</p>
          </div>
          <div className="product-surface-action__buttons">
            <button onClick={cancelProductAction} type="button">
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => void confirmProductAction()}
              type="button"
            >
              Confirm
            </button>
          </div>
        </section>
      )}
      <iframe
        {...credentiallessFrame}
        allow=""
        onLoad={provideCapability}
        ref={iframeRef}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-same-origin"
        src={`${state.resolved.origin}${state.resolved.entryPath}`}
        title={state.resolved.title}
      />
    </section>
  );
}

const strictOptions: SchemaAST.ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

async function prepareProductAction(
  fetcher: typeof fetch,
  origin: string,
  path: string,
  credential: string,
  action: string,
  inputJson: string,
) {
  const input: unknown = JSON.parse(inputJson);
  const body: {
    readonly version: 1;
    readonly action: string;
    readonly input: unknown;
  } = { version: 1, action, input };
  const response = await productActionFetch(
    fetcher,
    `${origin}${path}/prepare`,
    credential,
    body,
  );
  return {
    body,
    response: await Schema.decodeUnknownPromise(ProductActionPrepared)(
      response,
      strictOptions,
    ),
  };
}

async function executeProductAction(
  fetcher: typeof fetch,
  origin: string,
  path: string,
  credential: string,
  body: {
    readonly version: 1;
    readonly action: string;
    readonly input: unknown;
  },
) {
  const response = await productActionFetch(
    fetcher,
    `${origin}${path}/execute`,
    credential,
    body,
  );
  return Schema.decodeUnknownPromise(ProductActionWritten)(
    response,
    strictOptions,
  );
}

async function productActionFetch(
  fetcher: typeof fetch,
  url: string,
  credential: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Product action request failed");
  return response.json();
}
