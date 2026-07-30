import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  isAgentSessionActive,
  type AgentSessionStatus,
} from "../hooks/use-agent-session";

export interface ShapingController {
  readonly status: "idle" | "shaping" | "preview" | "error";
  readonly error?: string;
  readonly isolation: "unchecked" | "checking" | "ready" | "unavailable";
  readonly verifyIsolation: () => Promise<void>;
  readonly request: (instruction: string) => Promise<void>;
  readonly accept: () => Promise<void>;
  readonly reject: () => Promise<void>;
  readonly rollback: () => Promise<void>;
}

export function ShaperPanel({
  controller,
  agentStatus,
  onClose,
}: {
  readonly controller: ShapingController;
  readonly agentStatus: AgentSessionStatus;
  readonly onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const previousStatus = useRef(controller.status);
  const operationActive =
    controller.status === "shaping" || isAgentSessionActive(agentStatus);

  useEffect(() => {
    if (
      previousStatus.current === "preview" &&
      controller.status !== "preview"
    ) {
      instructionRef.current?.focus();
    }
    previousStatus.current = controller.status;
  }, [controller.status]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = instruction.trim();
    if (next && !operationActive) {
      void controller.request(next);
    }
  };

  return (
    <aside aria-label="Interface Shaper" className="shaper-panel">
      <header className="shaper-panel__header">
        <div>
          <span className="shaper-panel__eyebrow">Protected workspace</span>
          <h2>Shape with Pi</h2>
        </div>
        <button
          aria-label="Close interface Shaper"
          className="shaper-panel__close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </header>

      <p className="shaper-panel__intro">
        Describe the interface you want. Shaper proposes; Flect validates and
        previews before anything is kept.
      </p>

      <form className="shaper-form" onSubmit={submit}>
        <label htmlFor="shaper-instruction">
          Describe the interface change
        </label>
        <textarea
          disabled={operationActive}
          id="shaper-instruction"
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Make this a focused project dashboard…"
          ref={instructionRef}
          value={instruction}
        />
        <button
          className="shaper-primary"
          disabled={!instruction.trim() || operationActive}
          type="submit"
        >
          {controller.status === "shaping" ? "Shaping…" : "Propose change"}
        </button>
      </form>

      {controller.status === "preview" && (
        <section className="revision-card" aria-live="polite">
          <div>
            <span className="revision-card__dot" />
            <strong>Previewing a validated proposal</strong>
          </div>
          <p>The active interface is unchanged until you keep this revision.</p>
          <div className="revision-card__actions">
            <button
              className="shaper-primary"
              disabled={operationActive}
              onClick={() => void controller.accept()}
              type="button"
            >
              Keep change
            </button>
            <button
              className="shaper-secondary"
              disabled={operationActive}
              onClick={() => void controller.reject()}
              type="button"
            >
              Reject
            </button>
          </div>
        </section>
      )}

      {controller.status === "error" && (
        <p className="shaper-error" role="alert">
          {controller.error}
        </p>
      )}

      <footer className="shaper-panel__footer">
        <button
          className="shaper-secondary"
          disabled={operationActive}
          onClick={() => void controller.rollback()}
          type="button"
        >
          Roll back last change
        </button>
        <div className="trust-stack">
          <span>Guardian protected</span>
          <span aria-live="polite">
            {controller.isolation === "ready"
              ? "Extensions isolated"
              : controller.isolation === "unavailable"
                ? "Isolation unavailable"
                : "Checking isolation…"}
          </span>
        </div>
      </footer>
    </aside>
  );
}
