# Flect architecture

Flect is an agent-native interface shell. The initial architecture keeps the
customizable experience small while establishing the trust boundaries needed
for self-modifying interfaces later.

## Components

### Browser shell

The React application renders the launcher, conversation, model selection,
and a versioned interface document. It may keep transient UI state, but it
does not hold provider credentials or call model providers.

### Local runtime

A Bun service binds to `127.0.0.1:3210`. It owns Pi SDK integration, model
discovery, agent sessions, prompt streaming, cancellation, and public error
redaction. Vite proxies `/api` to this service during development.

### Pi

Pi is the first local agent runtime and provider-access backend. Its
`ModelRuntime` resolves OAuth tokens, API keys, environment credentials, and
custom models through Pi's own supported mechanisms. Flect consumes the
resulting available-model catalog and never creates shadow credential state.

### Shared contracts

Strict, versioned Zod schemas define runtime requests, public responses,
streamed events, and the customizable interface document. Both processes
validate data at the boundary.

### Protected recovery

The built-in launcher and safe mode are compiled into the shell and remain
outside user-modifiable interface state. `?safe=1` bypasses customized state.
Invalid or unsupported documents fail closed to the built-in launcher.

## Trust boundaries

```text
User
  |
  v
Browser shell -- validated local HTTP/SSE --> Loopback runtime
                                                |
                                                v
                                       Pi ModelRuntime/session
                                                |
                                                v
                                        User-selected provider
```

- Credentials remain on the runtime side of the HTTP boundary.
- Prompts cross the boundary only after explicit submission.
- The first Pi session has no tools.
- The runtime accepts only expected local origins.
- No hosted Flect fallback receives prompts or credentials.

## Interface documents

The first document format controls only launcher copy and a fixed set of
secondary actions. It cannot replace shell behavior, register tools, alter
runtime endpoints, or intercept safe mode. Arbitrary code and extension
sandboxing are intentionally deferred.

## Runtime lifecycle

1. The browser asks for runtime status and authenticated model summaries.
2. The user accepts automatic selection or chooses a model.
3. The browser creates an in-memory session through the loopback API.
4. The runtime creates a tool-free Pi session.
5. A submitted prompt streams sanitized Flect events back to the browser.
6. Session state disappears when the runtime process exits.

See the [MVP design](docs/superpowers/specs/2026-07-29-flect-mvp-design.md)
and [implementation plan](docs/superpowers/plans/2026-07-29-flect-mvp.md) for
the initial milestone.
