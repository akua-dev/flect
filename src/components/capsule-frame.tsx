import { invoke, isTauri } from "@tauri-apps/api/core";
import { Effect } from "effect";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CanvasSelection } from "../../shared/canvas-selection";
import {
  type CapsuleHostMessage,
  type CapsuleIntent,
  CapsuleIntentFailed,
  type CapsuleIntentOutcome,
  decodeCapsuleHostMessage,
  decodeCapsuleMessage,
} from "../../shared/capsule-protocol";

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "font-src data:",
  "media-src data: blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const bridgeNonce = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

const bridgeNonceFor = (_document: string) => bridgeNonce();

const bridgeFor = (nonce: string) =>
  `<script>(()=>{
const nonce=${JSON.stringify(nonce)};
let attempts=0,timer,port,selectionEnabled=false,selectedElement,framePending=false;
const announce=()=>{parent.postMessage({version:1,type:"flect:bridge-ready",nonce},"*");attempts+=1;if(attempts>=20)clearInterval(timer)};
const clean=value=>String(value??"").replace(/\\s+/g," ").trim();
const selectorFor=element=>{
  const explicit=clean(element.getAttribute("data-flect-id")||element.id||element.getAttribute("data-testid"));
  if(explicit)return explicit.slice(0,240);
  const parts=[];let current=element;
  while(current&&current!==document.body&&parts.length<8){
    const tag=current.localName||"element";
    let index=1,sibling=current;
    while((sibling=sibling.previousElementSibling))if(sibling.localName===tag)index+=1;
    parts.unshift(tag+":nth-of-type("+index+")");current=current.parentElement;
  }
  return parts.join(" > ").slice(0,240)||element.localName||"element";
};
const selectionFor=element=>{
  const rect=element.getBoundingClientRect();
  const style=getComputedStyle(element);
  const tag=(element.localName||"element").toLowerCase().slice(0,40);
  const privateText=element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement||element instanceof HTMLSelectElement;
  const visible=privateText?"":clean(element.innerText||element.textContent).slice(0,500);
  const aria=clean(element.getAttribute("aria-label")||element.getAttribute("title")||element.getAttribute("alt"));
  const label=(aria||visible||tag).slice(0,240);
  const role=clean(element.getAttribute("role")).slice(0,80);
  const source=clean(element.getAttribute("data-flect-source")).slice(0,240);
  const line=Number.parseInt(element.getAttribute("data-flect-line")||"",10);
  return {version:1,semanticId:selectorFor(element),tag,label,...(role?{role}:{}),...(visible?{text:visible}:{}),...(/^(?!\\/)(?!.*(?:^|\\/)\\.\\.?(?:\\/|$))[A-Za-z0-9._-]+(?:\\/[A-Za-z0-9._-]+)*$/.test(source)?{sourcePath:source,...(Number.isInteger(line)&&line>0&&line<=1000000?{sourceLine:line}:{})}:{}),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},styles:{display:style.display||"initial",position:style.position||"static",color:style.color||"transparent",backgroundColor:style.backgroundColor||"transparent",fontSize:style.fontSize||"initial",fontWeight:style.fontWeight||"normal",gap:style.gap||"normal",padding:style.padding||"0px",margin:style.margin||"0px"}};
};
const publish=element=>{if(!port)return;selectedElement=element;port.postMessage({version:1,type:"selection-changed",...(element?{selection:selectionFor(element)}:{})})};
const selectable=event=>event.composedPath().find(value=>value instanceof HTMLElement&&!value.matches("html,body,script,style,link,meta"));
addEventListener("click",event=>{if(!selectionEnabled)return;const element=selectable(event);if(!element)return;event.preventDefault();event.stopImmediatePropagation();publish(element)},true);
addEventListener("keydown",event=>{if(!selectionEnabled)return;if(event.key==="Escape"){event.preventDefault();event.stopImmediatePropagation();publish(undefined);return}if(event.key!=="Enter")return;const element=document.activeElement instanceof HTMLElement?document.activeElement:undefined;if(!element||element===document.body)return;event.preventDefault();event.stopImmediatePropagation();publish(element)},true);
const refreshSelection=()=>{framePending=false;if(selectionEnabled&&selectedElement?.isConnected)publish(selectedElement)};
const scheduleRefresh=()=>{if(framePending)return;framePending=true;requestAnimationFrame(refreshSelection)};
addEventListener("scroll",scheduleRefresh,true);addEventListener("resize",scheduleRefresh);
const connect=event=>{if(event.data?.type!=="flect:connect"||event.data?.version!==1||event.data?.nonce!==nonce||event.ports.length!==1)return;removeEventListener("message",connect);clearInterval(timer);port=event.ports[0];Object.defineProperty(globalThis,"flect",{configurable:false,writable:false,value:Object.freeze({post(message){port.postMessage(message)}})});port.onmessage=message=>{if(message.data?.type==="selection-mode"&&message.data?.version===1){selectionEnabled=message.data.enabled===true;if(!selectionEnabled)selectedElement=undefined}dispatchEvent(new CustomEvent("flect:host",{detail:message.data}))};port.start();port.postMessage({version:1,type:"ready"})};
addEventListener("message",connect);announce();timer=setInterval(announce,100)
})()</script>`;

export interface CapsuleAsset {
  readonly path: string;
  readonly contents: Uint8Array;
}

const mimeTypes: Readonly<Record<string, string>> = {
  css: "text/css",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  mjs: "text/javascript",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  otf: "font/otf",
  png: "image/png",
  svg: "image/svg+xml",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
};

const decodeText = (contents: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(contents);

const base64 = (contents: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < contents.length; offset += 0x8000) {
    binary += String.fromCharCode(
      ...contents.subarray(offset, offset + 0x8000),
    );
  }
  return globalThis.btoa(binary);
};

const dataUrl = (asset: CapsuleAsset) => {
  const extension = asset.path.split(".").at(-1)?.toLowerCase() ?? "";
  const mime = mimeTypes[extension] ?? "application/octet-stream";
  return `data:${mime};base64,${base64(asset.contents)}`;
};

const resolvePath = (from: string, reference: string) => {
  const value = reference.trim().split(/[?#]/, 1)[0] ?? "";
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.startsWith("//")
  ) {
    return undefined;
  }
  const parts = [...from.split("/").slice(0, -1), ...value.split("/")];
  const resolved: Array<string> = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (resolved.pop() === undefined) return undefined;
      continue;
    }
    resolved.push(part);
  }
  return resolved.join("/");
};

const rewriteCss = (
  css: string,
  stylesheetPath: string,
  assets: ReadonlyMap<string, CapsuleAsset>,
) =>
  css.replace(
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    (original, _quote: string, reference: string) => {
      const path = resolvePath(stylesheetPath, reference);
      const asset = path === undefined ? undefined : assets.get(path);
      return asset === undefined ? original : `url("${dataUrl(asset)}")`;
    },
  );

export const projectCapsuleDocument = (
  html: string,
  entrypointPath = "index.html",
  files: ReadonlyArray<CapsuleAsset> = [],
) => {
  if (files.length === 0) return html;
  const assets = new Map(files.map((file) => [file.path, file]));
  const parsed = new DOMParser().parseFromString(html, "text/html");

  for (const link of parsed.querySelectorAll<HTMLLinkElement>(
    'link[rel~="stylesheet"][href]',
  )) {
    const path = resolvePath(entrypointPath, link.getAttribute("href") ?? "");
    const asset = path === undefined ? undefined : assets.get(path);
    if (path === undefined || asset === undefined) continue;
    try {
      const style = parsed.createElement("style");
      style.textContent = rewriteCss(decodeText(asset.contents), path, assets);
      if (link.media.length > 0) style.media = link.media;
      link.replaceWith(style);
    } catch {
      link.remove();
    }
  }

  for (const script of parsed.querySelectorAll<HTMLScriptElement>(
    "script[src]",
  )) {
    const path = resolvePath(entrypointPath, script.getAttribute("src") ?? "");
    const asset = path === undefined ? undefined : assets.get(path);
    if (asset === undefined) continue;
    try {
      script.removeAttribute("src");
      script.removeAttribute("integrity");
      script.removeAttribute("crossorigin");
      script.textContent = decodeText(asset.contents).replace(
        /<\/script/gi,
        "<\\/script",
      );
    } catch {
      script.remove();
    }
  }

  for (const element of parsed.querySelectorAll<HTMLElement>(
    "img[src], source[src], audio[src], video[src], input[type=image][src]",
  )) {
    const path = resolvePath(entrypointPath, element.getAttribute("src") ?? "");
    const asset = path === undefined ? undefined : assets.get(path);
    if (asset !== undefined) element.setAttribute("src", dataUrl(asset));
  }
  for (const element of parsed.querySelectorAll<HTMLElement>("video[poster]")) {
    const path = resolvePath(
      entrypointPath,
      element.getAttribute("poster") ?? "",
    );
    const asset = path === undefined ? undefined : assets.get(path);
    if (asset !== undefined) element.setAttribute("poster", dataUrl(asset));
  }
  for (const element of parsed.querySelectorAll<HTMLElement>("[style]")) {
    element.setAttribute(
      "style",
      rewriteCss(element.getAttribute("style") ?? "", entrypointPath, assets),
    );
  }
  for (const style of parsed.querySelectorAll<HTMLStyleElement>("style")) {
    style.textContent = rewriteCss(
      style.textContent ?? "",
      entrypointPath,
      assets,
    );
  }
  return `${parsed.head.innerHTML}${parsed.body.innerHTML}`;
};

const documentFor = (html: string, nonce: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">${bridgeFor(nonce)}</head><body>${html}</body></html>`;

export interface CapsuleFrameProps {
  readonly html: string;
  readonly entrypointPath?: string;
  readonly assets?: ReadonlyArray<CapsuleAsset>;
  readonly title?: string;
  readonly selectionMode?: boolean;
  readonly selection?: CanvasSelection;
  readonly onSelectionChange?: (selection: CanvasSelection | undefined) => void;
  readonly onDirectManipulation?: (
    kind: "move" | "resize",
    deltaX: number,
    deltaY: number,
  ) => void;
  readonly onIntent?: (intent: CapsuleIntent) => Promise<CapsuleIntentOutcome>;
  readonly onViolation?: () => void;
}

export function CapsuleFrame({
  html,
  entrypointPath,
  assets,
  title = "Flect app",
  selectionMode = false,
  selection,
  onSelectionChange,
  onDirectManipulation,
  onIntent,
  onViolation,
}: CapsuleFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const connectRef = useRef<(() => void) | undefined>(undefined);
  const portRef = useRef<MessagePort | undefined>(undefined);
  const onIntentRef = useRef(onIntent);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onViolationRef = useRef(onViolation);
  const onDirectManipulationRef = useRef(onDirectManipulation);
  const selectionModeRef = useRef(selectionMode);
  onIntentRef.current = onIntent;
  onSelectionChangeRef.current = onSelectionChange;
  onViolationRef.current = onViolation;
  onDirectManipulationRef.current = onDirectManipulation;
  selectionModeRef.current = selectionMode;
  const projectedDocument = useMemo(
    () => projectCapsuleDocument(html, entrypointPath, assets ?? []),
    [assets, entrypointPath, html],
  );
  const nonce = useMemo(
    () => bridgeNonceFor(projectedDocument),
    [projectedDocument],
  );
  const source = useMemo(
    () => documentFor(projectedDocument, nonce),
    [nonce, projectedDocument],
  );
  const frameSource = useMemo(
    () => `data:text/html;base64,${base64(new TextEncoder().encode(source))}`,
    [source],
  );
  const nativeHost = useMemo(isTauri, []);
  const [nativeFrame, setNativeFrame] = useState<{
    readonly source: string;
    readonly url: string;
  }>();
  const [failedSource, setFailedSource] = useState<string>();
  const [height, setHeight] = useState<{
    readonly source: string;
    readonly value: number;
  }>();
  const manipulationRef = useRef<
    | {
        readonly kind: "move" | "resize";
        readonly pointerId: number;
        readonly x: number;
        readonly y: number;
      }
    | undefined
  >(undefined);
  const [manipulationPreview, setManipulationPreview] = useState<{
    readonly kind: "move" | "resize";
    readonly deltaX: number;
    readonly deltaY: number;
  }>();
  const mountedFrameSource = nativeHost
    ? nativeFrame?.source === source
      ? nativeFrame.url
      : undefined
    : frameSource;

  useEffect(() => {
    if (!nativeHost) return;
    let disposed = false;
    let registered = false;
    const release = () =>
      Effect.runPromise(
        Effect.tryPromise({
          try: () => invoke("capsule_document_release", { token: nonce }),
          catch: () => undefined,
        }),
      ).catch(() => undefined);
    void Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          invoke<string>("capsule_document_register", {
            document: source,
            token: nonce,
          }),
        catch: () => undefined,
      }),
    ).then(
      (url) => {
        registered = true;
        if (disposed) {
          void release();
          return;
        }
        setNativeFrame({ source, url });
      },
      () => {
        if (disposed) return;
        setFailedSource(source);
        onViolationRef.current?.();
      },
    );
    return () => {
      disposed = true;
      if (registered) void release();
    };
  }, [nativeHost, nonce, source]);

  useEffect(() => {
    if (mountedFrameSource === undefined) return;
    const frame = frameRef.current;
    if (frame === null) return;
    let disposed = false;
    let windowStarted = performance.now();
    let messages = 0;
    const pendingPorts = new Set<MessagePort>();
    const fail = () => {
      if (disposed) return;
      disposed = true;
      for (const port of pendingPorts) port.close();
      pendingPorts.clear();
      portRef.current?.close();
      portRef.current = undefined;
      setFailedSource(source);
      onViolationRef.current?.();
    };
    const timeout = globalThis.setTimeout(fail, 2_000);
    const visibility = () => {
      const message: CapsuleHostMessage = {
        version: 1,
        type: "visibility",
        visible: document.visibilityState === "visible",
      };
      portRef.current?.postMessage(message);
    };
    const connect = () => {
      if (
        disposed ||
        frame.contentWindow === null ||
        portRef.current !== undefined
      ) {
        return;
      }
      if (pendingPorts.size >= 4) {
        const oldest = pendingPorts.values().next().value;
        if (oldest !== undefined) {
          oldest.close();
          pendingPorts.delete(oldest);
        }
      }
      const channel = new MessageChannel();
      pendingPorts.add(channel.port1);
      channel.port1.onmessage = (event) => {
        const now = performance.now();
        if (now - windowStarted >= 1_000) {
          windowStarted = now;
          messages = 0;
        }
        messages += 1;
        if (messages > 60) {
          fail();
          return;
        }
        void Effect.runPromise(decodeCapsuleMessage(event.data)).then(
          (message) => {
            if (disposed) return;
            if (message.type === "ready") {
              for (const port of pendingPorts) {
                if (port !== channel.port1) port.close();
              }
              pendingPorts.clear();
              portRef.current = channel.port1;
              globalThis.clearTimeout(timeout);
              visibility();
              channel.port1.postMessage({
                version: 1,
                type: "selection-mode",
                enabled: selectionModeRef.current,
              } satisfies CapsuleHostMessage);
            } else if (message.type === "resize") {
              setHeight({ source, value: message.height });
            } else if (message.type === "selection-changed") {
              onSelectionChangeRef.current?.(message.selection);
            } else {
              const failed = CapsuleIntentFailed.make({
                version: 1,
                type: "intent-result",
                id: message.id,
                ok: false,
                error: {
                  code: "failed",
                  message: "The product operation failed safely.",
                },
              });
              const unavailable = CapsuleIntentFailed.make({
                version: 1,
                type: "intent-result",
                id: message.id,
                ok: false,
                error: {
                  code: "unavailable",
                  message: "The product operation is unavailable.",
                },
              });
              const invalidResult = CapsuleIntentFailed.make({
                version: 1,
                type: "intent-result",
                id: message.id,
                ok: false,
                error: {
                  code: "invalid-result",
                  message: "The product operation returned an invalid result.",
                },
              });
              void (async () => {
                let requested: CapsuleIntentOutcome;
                try {
                  requested =
                    onIntentRef.current === undefined
                      ? unavailable
                      : await onIntentRef.current(message);
                } catch {
                  requested = failed;
                }
                let outcome: CapsuleIntentOutcome;
                try {
                  const decoded = await Effect.runPromise(
                    decodeCapsuleHostMessage(requested),
                  );
                  outcome =
                    decoded.type === "intent-result" &&
                    decoded.id === message.id
                      ? decoded
                      : invalidResult;
                } catch {
                  outcome = invalidResult;
                }
                if (!disposed && portRef.current === channel.port1) {
                  channel.port1.postMessage(outcome);
                }
              })();
            }
          },
          fail,
        );
      };
      channel.port1.start();
      frame.contentWindow.postMessage(
        { version: 1, type: "flect:connect", nonce },
        "*",
        [channel.port2],
      );
    };
    const bridgeReady = (event: MessageEvent) => {
      if (
        event.data?.version !== 1 ||
        event.data?.type !== "flect:bridge-ready" ||
        event.data?.nonce !== nonce
      ) {
        return;
      }
      connect();
    };
    connectRef.current = connect;
    document.addEventListener("visibilitychange", visibility);
    globalThis.addEventListener("message", bridgeReady);
    connect();
    return () => {
      disposed = true;
      globalThis.clearTimeout(timeout);
      if (connectRef.current === connect) connectRef.current = undefined;
      document.removeEventListener("visibilitychange", visibility);
      globalThis.removeEventListener("message", bridgeReady);
      for (const port of pendingPorts) port.close();
      pendingPorts.clear();
      portRef.current?.postMessage({
        version: 1,
        type: "dispose",
      } satisfies CapsuleHostMessage);
      portRef.current?.close();
      portRef.current = undefined;
    };
  }, [mountedFrameSource, nonce, source]);

  useEffect(() => {
    portRef.current?.postMessage({
      version: 1,
      type: "selection-mode",
      enabled: selectionMode,
    } satisfies CapsuleHostMessage);
  }, [selectionMode]);

  useEffect(() => {
    void source;
    onSelectionChangeRef.current?.(undefined);
  }, [source]);

  const beginManipulation = (
    kind: "move" | "resize",
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    manipulationRef.current = {
      kind,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setManipulationPreview({ kind, deltaX: 0, deltaY: 0 });
  };

  const moveManipulation = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = manipulationRef.current;
    if (origin === undefined || origin.pointerId !== event.pointerId) return;
    event.preventDefault();
    setManipulationPreview({
      kind: origin.kind,
      deltaX: event.clientX - origin.x,
      deltaY: event.clientY - origin.y,
    });
  };

  const finishManipulation = (event: ReactPointerEvent<HTMLElement>) => {
    const origin = manipulationRef.current;
    if (origin === undefined || origin.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - origin.x;
    const deltaY = event.clientY - origin.y;
    manipulationRef.current = undefined;
    setManipulationPreview(undefined);
    if (Math.hypot(deltaX, deltaY) < 4) return;
    onDirectManipulationRef.current?.(origin.kind, deltaX, deltaY);
  };

  if (failedSource === source) {
    return (
      <section className="capsule-fallback" role="status">
        <strong>This Flect app was stopped safely.</strong>
        <p>
          Use the protected agent rail to recover or choose another revision.
        </p>
      </section>
    );
  }

  if (mountedFrameSource === undefined) {
    return (
      <section className="capsule-fallback" role="status">
        <p>Opening this Flect app.</p>
      </section>
    );
  }

  return (
    <div className="capsule-surface">
      <iframe
        className="capsule-frame"
        onFocus={() =>
          portRef.current?.postMessage({
            version: 1,
            type: "focus",
          } satisfies CapsuleHostMessage)
        }
        onLoad={() => connectRef.current?.()}
        ref={frameRef}
        sandbox="allow-scripts"
        src={mountedFrameSource}
        style={
          height?.source === source
            ? { height: `${height.value}px` }
            : undefined
        }
        title={title}
      />
      {selection !== undefined && (
        <fieldset
          aria-label={`Selected element: ${selection.label}. Drag to move.`}
          className="canvas-selection-outline"
          onPointerCancel={finishManipulation}
          onPointerDown={(event) => beginManipulation("move", event)}
          onPointerMove={moveManipulation}
          onPointerUp={finishManipulation}
          style={{
            left:
              selection.rect.x +
              (manipulationPreview?.kind === "move"
                ? manipulationPreview.deltaX
                : 0),
            top:
              selection.rect.y +
              (manipulationPreview?.kind === "move"
                ? manipulationPreview.deltaY
                : 0),
            width: Math.max(
              16,
              selection.rect.width +
                (manipulationPreview?.kind === "resize"
                  ? manipulationPreview.deltaX
                  : 0),
            ),
            height: Math.max(
              16,
              selection.rect.height +
                (manipulationPreview?.kind === "resize"
                  ? manipulationPreview.deltaY
                  : 0),
            ),
          }}
        >
          <span>{selection.label}</span>
          <button
            aria-label={`Resize selected element: ${selection.label}`}
            className="canvas-selection-resize"
            onPointerCancel={finishManipulation}
            onPointerDown={(event) => beginManipulation("resize", event)}
            onPointerMove={moveManipulation}
            onPointerUp={finishManipulation}
            type="button"
          />
        </fieldset>
      )}
    </div>
  );
}
