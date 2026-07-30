import { Effect, Fiber, Stream } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExtensionManifest } from "../shared/extensions";
import {
  defaultInterfaceDocument,
  type InterfaceDocument,
} from "../shared/interface-document";
import type { RevisionId, ShapingSnapshot } from "../shared/revisions";
import { Launcher } from "./components/launcher";
import type { ShapingController } from "./components/shaper-panel";
import {
  isAgentSessionActive,
  useAgentSession,
} from "./hooks/use-agent-session";
import {
  consumeLegacyInterfaceDocument,
  loadInterfaceDocument,
} from "./lib/interface-store";
import { browserRuntime, shapingRuntime } from "./lib/runtime";
import { ShapingKernel } from "./lib/shaping-kernel";
import { ExtensionExecution } from "./sandbox/extension-execution";

const safeMode =
  new URLSearchParams(globalThis.location.search).get("safe") === "1";

const isolationCheck = ExtensionManifest.make({
  version: 1,
  id: "isolation-check",
  name: "Flect isolation check",
  source: `() => ({
    type: "set-text",
    target: "isolation-status",
    text: [
      typeof fetch,
      typeof document,
      typeof localStorage,
      typeof process,
      typeof Bun,
      typeof Function
    ].join(",")
  })`,
  capabilities: ["interface:propose"],
});

export function App() {
  const [document, setDocument] = useState<InterfaceDocument>(
    defaultInterfaceDocument,
  );
  const [protectedMode, setProtectedMode] = useState(safeMode);
  const session = useAgentSession();
  const shapeRequestRef = useRef(0);
  const decisionInFlightRef = useRef(false);
  const [shapingStatus, setShapingStatus] =
    useState<ShapingController["status"]>("idle");
  const [shapingError, setShapingError] = useState<string>();
  const [proposalId, setProposalId] = useState<RevisionId>();
  const [isolation, setIsolation] =
    useState<ShapingController["isolation"]>("unchecked");

  useEffect(() => {
    let mounted = true;

    const applySnapshot = (snapshot: ShapingSnapshot) => {
      if (!mounted) {
        return;
      }
      const preview =
        snapshot.proposal?.status === "previewed"
          ? snapshot.proposal
          : undefined;
      setDocument(
        snapshot.safeMode
          ? defaultInterfaceDocument
          : (preview?.document ?? snapshot.active.document),
      );
      setProtectedMode(snapshot.safeMode);
      setProposalId(preview?.id);
      if (snapshot.safeMode) {
        shapeRequestRef.current += 1;
        setShapingStatus("idle");
        setShapingError(undefined);
      }
    };

    const observeKernel = Effect.gen(function* () {
      const kernel = yield* ShapingKernel;
      const snapshot = yield* kernel.snapshot;
      if (safeMode) {
        yield* kernel.enterSafeMode;
      } else if (
        !snapshot.safeMode &&
        snapshot.lastEvent.type === "initialized"
      ) {
        const legacy = yield* Effect.promise(() =>
          browserRuntime.runPromise(loadInterfaceDocument({ safeMode: false })),
        );
        const restored = yield* kernel.propose(legacy, "user");
        yield* kernel.preview(restored.id);
        yield* kernel.accept(restored.id);
        yield* Effect.promise(() =>
          browserRuntime.runPromise(consumeLegacyInterfaceDocument()),
        );
      }

      yield* kernel.snapshot.pipe(
        Effect.tap((current) => Effect.sync(() => applySnapshot(current))),
      );
      yield* kernel.changes.pipe(
        Stream.runForEach((current) =>
          Effect.sync(() => applySnapshot(current)),
        ),
      );
    }).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          if (mounted) {
            setDocument(defaultInterfaceDocument);
            setProtectedMode(true);
            setProposalId(undefined);
          }
        }),
      ),
    );
    const observer = shapingRuntime.runFork(observeKernel);

    return () => {
      mounted = false;
      shapingRuntime.runFork(Fiber.interrupt(observer));
    };
  }, []);

  const requestShape = useCallback(
    async (instruction: string) => {
      if (protectedMode) {
        setShapingStatus("error");
        setShapingError("Leave safe mode before shaping the interface.");
        return;
      }
      if (
        isAgentSessionActive(session.status) ||
        shapingStatus === "shaping" ||
        decisionInFlightRef.current
      ) {
        return;
      }

      const requestId = shapeRequestRef.current + 1;
      shapeRequestRef.current = requestId;
      setShapingStatus("shaping");
      setShapingError(undefined);
      try {
        const active = await shapingRuntime.runPromise(
          Effect.gen(function* () {
            const kernel = yield* ShapingKernel;
            return (yield* kernel.snapshot).active.document;
          }),
        );
        const candidate = await session.shape(instruction, active);
        if (shapeRequestRef.current !== requestId) {
          return;
        }
        const preview = await shapingRuntime.runPromise(
          Effect.gen(function* () {
            const kernel = yield* ShapingKernel;
            const proposal = yield* kernel.propose(candidate, "shaper");
            return yield* kernel.preview(proposal.id);
          }),
        );
        if (shapeRequestRef.current !== requestId) {
          return;
        }
        setProposalId(preview.id);
        setDocument(preview.document);
        setShapingStatus("preview");
      } catch {
        if (shapeRequestRef.current !== requestId) {
          return;
        }
        setShapingStatus("error");
        setShapingError("Shaper could not produce a valid interface proposal.");
      }
    },
    [protectedMode, session.shape, session.status, shapingStatus],
  );

  const acceptShape = useCallback(async () => {
    if (
      proposalId === undefined ||
      isAgentSessionActive(session.status) ||
      shapingStatus === "shaping" ||
      decisionInFlightRef.current
    ) {
      return;
    }
    decisionInFlightRef.current = true;
    setShapingStatus("shaping");
    try {
      const accepted = await shapingRuntime.runPromise(
        Effect.gen(function* () {
          const kernel = yield* ShapingKernel;
          return yield* kernel.accept(proposalId);
        }),
      );
      setDocument(accepted.document);
      setProtectedMode(false);
      setProposalId(undefined);
      setShapingStatus("idle");
    } catch {
      setShapingStatus("error");
      setShapingError("The revision could not be accepted safely.");
    } finally {
      decisionInFlightRef.current = false;
    }
  }, [proposalId, session.status, shapingStatus]);

  const rejectShape = useCallback(async () => {
    if (
      proposalId === undefined ||
      isAgentSessionActive(session.status) ||
      shapingStatus === "shaping" ||
      decisionInFlightRef.current
    ) {
      return;
    }
    decisionInFlightRef.current = true;
    setShapingStatus("shaping");
    try {
      await shapingRuntime
        .runPromise(
          Effect.gen(function* () {
            const kernel = yield* ShapingKernel;
            yield* kernel.reject(proposalId);
            return (yield* kernel.snapshot).active.document;
          }),
        )
        .then(setDocument);
      setProposalId(undefined);
      setShapingStatus("idle");
    } catch {
      setShapingStatus("error");
      setShapingError("The proposal could not be rejected safely.");
    } finally {
      decisionInFlightRef.current = false;
    }
  }, [proposalId, session.status, shapingStatus]);

  const rollbackShape = useCallback(async () => {
    if (
      isAgentSessionActive(session.status) ||
      shapingStatus === "shaping" ||
      decisionInFlightRef.current
    ) {
      return;
    }
    shapeRequestRef.current += 1;
    decisionInFlightRef.current = true;
    setShapingStatus("shaping");
    try {
      const recovered = await shapingRuntime.runPromise(
        Effect.gen(function* () {
          const kernel = yield* ShapingKernel;
          return yield* kernel.rollback;
        }),
      );
      setDocument(recovered.document);
      setProtectedMode(false);
      setProposalId(undefined);
      setShapingStatus("idle");
    } catch {
      let message = "Flect could not restore the last-known-good interface.";
      try {
        const diagnostic = await session.diagnoseRecovery("rollback-failed");
        message = `${message} ${diagnostic.message}`;
      } catch {
        // The protected launcher remains usable without an AI diagnostic.
      }
      setShapingStatus("error");
      setShapingError(message);
    } finally {
      decisionInFlightRef.current = false;
    }
  }, [session.diagnoseRecovery, session.status, shapingStatus]);

  const verifyIsolation = useCallback(async () => {
    if (isolation === "checking" || isolation === "ready") {
      return;
    }
    setIsolation("checking");
    try {
      const result = await shapingRuntime.runPromise(
        Effect.gen(function* () {
          const execution = yield* ExtensionExecution;
          return yield* execution.execute(isolationCheck, {}, [
            "interface:propose",
          ]);
        }),
      );
      const first = result.intents[0];
      setIsolation(
        first?.type === "set-text" &&
          first.text ===
            "undefined,undefined,undefined,undefined,undefined,undefined"
          ? "ready"
          : "unavailable",
      );
    } catch {
      setIsolation("unavailable");
    }
  }, [isolation]);

  return (
    <Launcher
      document={document}
      safeMode={protectedMode}
      session={session}
      shaping={{
        status: shapingStatus,
        ...(shapingError === undefined ? {} : { error: shapingError }),
        isolation,
        verifyIsolation,
        request: requestShape,
        accept: acceptShape,
        reject: rejectShape,
        rollback: rollbackShape,
      }}
    />
  );
}
