import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";
import { ExtensionManifest } from "../shared/extensions";
import {
  defaultInterfaceDocument,
  type InterfaceDocument,
} from "../shared/interface-document";
import type { RevisionId } from "../shared/revisions";
import { Launcher } from "./components/launcher";
import type { ShapingController } from "./components/shaper-panel";
import { useAgentSession } from "./hooks/use-agent-session";
import { loadInterfaceDocument } from "./lib/interface-store";
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
  const [shapingStatus, setShapingStatus] =
    useState<ShapingController["status"]>("idle");
  const [shapingError, setShapingError] = useState<string>();
  const [proposalId, setProposalId] = useState<RevisionId>();
  const [isolation, setIsolation] =
    useState<ShapingController["isolation"]>("unchecked");

  useEffect(() => {
    let mounted = true;

    void shapingRuntime
      .runPromise(
        Effect.gen(function* () {
          const kernel = yield* ShapingKernel;
          const snapshot = yield* kernel.snapshot;
          if (safeMode) {
            yield* kernel.enterSafeMode;
            return {
              document: defaultInterfaceDocument,
              protectedMode: true,
            };
          }
          if (snapshot.lastEvent.type !== "initialized") {
            return {
              document: snapshot.active.document,
              protectedMode: snapshot.safeMode,
            };
          }

          const legacy = yield* Effect.promise(() =>
            browserRuntime.runPromise(
              loadInterfaceDocument({ safeMode: false }),
            ),
          );
          const restored = yield* kernel.propose(legacy, "user");
          yield* kernel.preview(restored.id);
          const accepted = yield* kernel.accept(restored.id);
          return {
            document: accepted.document,
            protectedMode: false,
          };
        }),
      )
      .then((restored) => {
        if (mounted) {
          setDocument(restored.document);
          setProtectedMode(restored.protectedMode);
        }
      })
      .catch(() => {
        if (mounted) {
          setDocument(defaultInterfaceDocument);
          setProtectedMode(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const requestShape = useCallback(
    async (instruction: string) => {
      if (protectedMode) {
        setShapingStatus("error");
        setShapingError("Leave safe mode before shaping the interface.");
        return;
      }

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
        const preview = await shapingRuntime.runPromise(
          Effect.gen(function* () {
            const kernel = yield* ShapingKernel;
            const proposal = yield* kernel.propose(candidate, "shaper");
            return yield* kernel.preview(proposal.id);
          }),
        );
        setProposalId(preview.id);
        setDocument(preview.document);
        setShapingStatus("preview");
      } catch {
        setShapingStatus("error");
        setShapingError("Shaper could not produce a valid interface proposal.");
      }
    },
    [protectedMode, session.shape],
  );

  const acceptShape = useCallback(async () => {
    if (proposalId === undefined) {
      return;
    }
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
    }
  }, [proposalId]);

  const rejectShape = useCallback(async () => {
    if (proposalId === undefined) {
      return;
    }
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
    }
  }, [proposalId]);

  const rollbackShape = useCallback(async () => {
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
      setShapingStatus("error");
      setShapingError("Flect could not restore the last-known-good interface.");
    }
  }, []);

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
