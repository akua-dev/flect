# Flect

> The interface that takes your shape.

![Flect adapting across analytics, research, and its agent-native shaping surface](assets/flect-hero.png)

Flect is an open-source, agent-native shell for interfaces that can be changed
from inside themselves.

The current milestone is a working local launcher: it discovers models already
authenticated through [Pi](https://pi.dev), creates protected tool-free
sessions, streams responses, and keeps a compiled safe-mode surface independent
from user customization.

## Why Flect

The agent is not a chatbot added beside a static application. It is the
programmable backbone of the interface: able to understand available
capabilities and, as the platform grows, compose, modify, and repair the
experience while it is in use.

Flect keeps the core small and puts capabilities, components, and opinions in
extensions. A product team can ship an excellent recommended experience while
leaving every user free to adapt it.

## Run it locally

Flect currently requires Bun and an existing Pi provider login.

```bash
bun install
bunx pi
```

Inside Pi, run `/login`, choose a subscription or API-key provider, then quit
Pi and start Flect:

```bash
bun run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The local runtime listens
only on `127.0.0.1:3210`; the browser shell uses Vite's `/api` proxy.

Flect reads Pi's supported authentication state. It does not copy provider
tokens into browser storage or create a second credential format.

## What works today

- authenticated model discovery through Pi;
- automatic or explicit model selection;
- in-memory, tool-free Pi sessions;
- streamed turns with cancellation and public error redaction;
- strict versioned contracts built with Effect Schema;
- one `ManagedRuntime` connecting React to Effect services and layers;
- fail-closed interface-document loading; and
- `?safe=1`, which bypasses customized interface state.

The prompt surface, secondary actions, and interface document establish the
product shape. Arbitrary generated UI code, sandboxed extensions, product API
capabilities, desktop packaging, and component sharing remain future work.

## Effect architecture

Effect is the application architecture rather than a utility dependency.

- boundary values are `Schema.Class` contracts;
- expected failures are tagged schema errors;
- Pi, runtime, browser transport, and storage are `Context.Service`
  capabilities;
- production and test implementations are `Layer` values;
- finite workflows use `Effect`;
- agent events and SSE bodies use `Stream`; and
- Bun and React execute programs only at their host boundaries.

All Effect packages are pinned to the same version. Run `bun run prepare` to
restore the matching official Effect source checkout used as this repository's
API reference.

## Verify

```bash
bun run check
bun run build
```

Read [VISION.md](VISION.md) for the destination, [ARCHITECTURE.md](ARCHITECTURE.md)
for current boundaries, and [CONTRIBUTING.md](CONTRIBUTING.md) before changing
the implementation.

## License

Flect is licensed under the [Apache License 2.0](LICENSE).
