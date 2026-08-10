# Flect product HTTP capability design

## Outcome

A Flect app or App Agent can request a named product operation without gaining
raw `fetch`, cookies, bearer tokens, sockets, or arbitrary-origin authority.
The product host owns policy and credentials; the portable app owns only typed
operation input.

## Boundary

- A trusted host registers bounded HTTP policies by stable ID.
- An untrusted caller supplies only policy ID, path, approved method, approved
  non-secret headers, and a bounded body.
- Flect constructs the URL, rejects origin/path/method/header violations before
  transport, injects credentials through a private host callback, enforces a
  deadline, and reads the response through a byte-bounded stream.
- Returned status, selected safe headers, and bytes are schema-defined.
- Failures expose a typed reason and fixed sanitized message, never transport
  bodies, credentials, or arbitrary exception text.
- Browser and native transports implement the same Effect service contract.

## Deliberate exclusions in this slice

GraphQL operation policies, resumable event subscriptions, capsule request /
response wiring, product auth UI, and the reference product remain separate
follow-on slices on the same registry boundary.
