# Flect in-product Pi authentication design

**Status:** Accepted for implementation from product-quality issue `#19` and
the authentication boundary already approved in the Flect MVP design.

## Outcome

A first-time browser or packaged-macOS user can discover Pi providers, complete
an approved login, select a compatible model and reasoning level, and send a
successful turn without opening a terminal. Pi remains the only credential
owner. No credential, authorization code, refresh token, callback payload, or
provider-native error enters ordinary Flect React state, workspace snapshots,
the operation journal, AXI, Git, shaped UI, extensions, logs, fixtures, or
screenshots.

This slice covers `FQ-01.3`–`FQ-01.5` and `FQ-12.1`–`FQ-12.6`.

## Authority boundary

Flect uses the pinned Pi `ModelRuntime` from `@earendil-works/pi-coding-agent`
0.82.1. Its provider-owned `auth`, `checkAuth`, `login`, `logout`, `refresh`,
and `getAvailable` contracts remain authoritative. Flect does not parse or
write `auth.json`, create a second credential schema, exchange OAuth tokens, or
call provider endpoints itself.

One runtime-scoped Effect `ProviderAuthentication` service adapts Pi's
`AuthInteraction` into a bounded public workflow. The service owns login
fibers, prompt waiters, cancellation, timeout, and refresh. It accepts only
closed provider/method identifiers discovered from the same runtime. Login and
logout are protected-shell operations and are intentionally absent from the
outside workspace command language and agent Bash.

The ordinary UI may receive only:

- provider identifier and display name;
- supported login method and Flect-authored method label;
- `connected | disconnected | needs-attention | checking` status;
- bounded public auth-source label after allowlisted normalization;
- model summaries and supported reasoning levels;
- Flect-authored progress or error codes and next actions;
- provider-declared public information links;
- an authorization URL or device-code verification URL; and
- a one-use protected-entry URL containing no credential value.

No raw thrown Pi/provider error crosses the service.

## Typed login lifecycle

At most one login per provider and a small bounded number globally may be
active. Starting a duplicate returns a typed busy conflict. Each interaction
has a random identifier, a scoped `AbortController`, a bounded event queue,
and at most one pending prompt. The public stream uses these phases:

```text
idle
  -> starting
  -> choosing          (safe select prompt)
  -> open-provider     (OAuth URL or device code)
  -> protected-entry   (secret, manual code, or arbitrary text prompt)
  -> waiting
  -> refreshing
  -> connected

any active phase -> cancelled | failed
```

Safe selection prompts expose option identifiers and labels and accept a typed
reply correlated by login and prompt identifier. Every free-text Pi prompt is
treated as sensitive because Flect cannot safely infer provider semantics from
prompt copy. It is handled by the protected credential-entry host instead of
the application WebView.

Per-prompt Pi abort signals race the associated waiter. Whole-login cancel
interrupts the fiber, aborts Pi, clears and wipes pending sensitive input,
closes any one-use listener, and emits one terminal event. Completion refreshes
provider/model summaries and invalidates only private sessions whose selection
is no longer valid.

## Protected credential-entry host

Browser and packaged desktop use the same runtime-owned one-use loopback form
for `secret`, `manual_code`, and arbitrary `text` prompts. This avoids making
React, Tauri IPC, or the public runtime schema a credential transport.

For each pending sensitive prompt, the private runtime binds an ephemeral
`127.0.0.1` listener and creates an unguessable one-use path. The ordinary UI
receives only its URL and opens it through an explicit user action. The page:

- has `default-src 'none'`, inline nonce-bound style only, and `form-action
  'self'`;
- sets `Cache-Control: no-store`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, and a restrictive permissions policy;
- loads no script, image, analytics, font, or third-party resource;
- carries no secret in URL, query, fragment, cookie, response, or browser
  storage;
- accepts one bounded form field through POST and immediately closes the
  listener after success, cancel, expiry, or first invalidating attempt;
- wraps the submitted value in Effect `Redacted`, supplies it directly to the
  pending Pi prompt, then wipes the wrapper after handoff; and
- returns only a fixed success/failure page with no reflected value.

The listener validates method, content type, content length, one-use path,
loopback peer, expiry, and prompt correlation. A remote runtime must provide an
equivalent reviewed credential host; otherwise Flect advertises only login
methods that never request user-entered sensitive data.

Authorization and verification links are limited to `https:` plus Pi's exact
loopback callback URLs. Flect never interpolates them into HTML. The user can
copy or open them through native browser behavior.

## Provider and model experience

The existing T3-inspired model menu becomes a provider-aware surface:

- current model remains the concise trigger;
- search matches model, provider, and identifier;
- providers show connected, not connected, or needs-attention state;
- supported Sign in methods are visible without pretending ambient-only
  providers can be logged into;
- Sign out is explicit and confirms that affected private sessions restart;
- Refresh checks Pi-owned state without asking for credentials;
- favorites remain local non-secret UI preference; and
- a reasoning control lists only levels supported by the selected Pi model,
  using `Off`, `Low`, `Medium`, `High`, `X-high`, and `Max` product labels.

Model summaries gain only capability metadata, never provider auth objects.
The selected reasoning level is part of the private `SessionSelection` key.
Changing model or reasoning level preserves visible conversations and
candidate state but disposes and lazily recreates the required Pi session sets.

When no provider is connected, the protected runtime alert offers **Choose a
provider** rather than terminal instructions. Safe mode, accepted rendering,
Keep/Reject, rollback, and diagnostics remain usable. A denied, cancelled,
expired, unsupported, malformed, or failed login ends in a Flect-authored state
with retry, choose another method, or return actions.

## Transport and state

Authentication is a private runtime capability alongside model discovery, not
a `FlectWorkspaceController` command and not revision state.

- Browser development uses same-origin JSON/SSE routes to the loopback Bun
  runtime.
- Packaged desktop uses the existing private Effect RPC/NDJSON sidecar.
- Both clients consume one Effect `ProviderAuthClient` service.
- Provider summaries may live in an auth-specific `SubscriptionRef`; active
  login events stay ephemeral and are never copied into workspace snapshots.
- AXI `inspect`, operation records, control SSE, MCP, and agent tools omit
  login identifiers, URLs, prompts, and source-native failures.

The server HTTP layer maintains the existing allowed-origin policy. The
protected-entry listener is intentionally navigation/form-only and exposes no
JSON or CORS API.

## Error model

Expected failures use closed tagged Effect errors:

- provider or method unavailable;
- login already active;
- prompt stale or mismatched;
- cancelled;
- expired;
- denied or rejected;
- credential host unavailable;
- provider authentication needs attention; and
- runtime authentication operation failed.

Messages are authored by Flect and reveal no raw provider payload. Defects
remain defects. Retry is limited to safe status/refresh reads; login, logout,
prompt reply, and callback processing are never automatically repeated.

## Verification

Contract tests must cover provider projection, lifecycle transitions,
selection correlation, cancellation races, timeout, logout, refresh, session
invalidation, and reasoning compatibility. Adversarial tests must seed unique
secret-shaped values and prove they are absent from encoded public contracts,
browser storage, workspace/control snapshots, AXI, operation journal, prompt
history, revision persistence, extension input, logs, and rendered screenshots.

Production Chromium must exercise disconnected → login → connected → model
selection → successful turn, plus cancellation, unavailable provider, refresh,
logout, safe-mode access, compact layout, keyboard, and reduced motion. The
packaged macOS app must repeat the successful path through public UI, with the
credential entry occurring only in the one-use runtime page. A live Pi smoke
confirms detection of existing approved auth and one real turn without
capturing provider data.

## Non-goals

- A Flect credential format or credential migration.
- Provider-specific OAuth implementation or callback parsing.
- Remote-runtime pairing beyond the capability seam and fail-closed policy.
- Product API authentication.
- Exposing authentication mutations through AXI, MCP, Shaper, App Agent,
  capsules, or extensions.
