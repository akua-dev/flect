import type {
  ControlStateSnapshot,
  OperationRecord,
  WorkspacePersistenceSnapshot,
} from "../../shared/control";
import type { NativeUpdateSnapshot } from "../../shared/native-update";
import type {
  AgentIntegrationHost,
  AgentIntegrationStatus,
  ShellLinkStatus,
} from "../../shared/setup";
import type { UninstallPlan } from "../../shared/uninstall";

export interface NativeSetupView {
  readonly available: boolean;
  readonly loading: boolean;
  readonly shell?: ShellLinkStatus;
  readonly agents: ReadonlyArray<AgentIntegrationStatus>;
  readonly error?: string;
  readonly refresh: () => Promise<void>;
  readonly installShell: () => Promise<void>;
  readonly removeShell: () => Promise<void>;
  readonly installAgent: (host: AgentIntegrationHost) => Promise<void>;
  readonly removeAgent: (host: AgentIntegrationHost) => Promise<void>;
  readonly uninstall?: UninstallPlan;
  readonly prepareUninstall: () => Promise<void>;
}

export interface NativeUpdateView {
  readonly snapshot?: NativeUpdateSnapshot;
  readonly loading: boolean;
  readonly error?: string;
  readonly check: () => Promise<void>;
  readonly install: (token: string) => Promise<void>;
  readonly relaunch: () => Promise<void>;
}

const stateLabel = (
  state: ShellLinkStatus["state"] | AgentIntegrationStatus["state"],
) => {
  switch (state) {
    case "absent":
      return "Not installed";
    case "installed":
      return "Installed";
    case "stale":
      return "Needs repair";
    case "conflict":
      return "Conflict — existing file preserved";
  }
};

const hostLabel = (host: AgentIntegrationHost) => {
  switch (host) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude Code";
    case "opencode":
      return "OpenCode";
  }
};

const retainedLabel = (kind: UninstallPlan["retained"][number]["kind"]) => {
  switch (kind) {
    case "workspace-data":
      return "Workspace data";
    case "provider-authentication":
      return "Provider authentication";
    case "exports":
      return "Exports";
  }
};

const updateSize = (bytes: number | undefined) =>
  bytes === undefined
    ? "Size reported during download"
    : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`;

export function DiagnosticsPanel({
  control,
  operations,
  onToggleControl,
  persistence,
  setup,
  update,
}: {
  readonly control: ControlStateSnapshot;
  readonly operations: ReadonlyArray<OperationRecord>;
  readonly onToggleControl: () => Promise<void>;
  readonly persistence?: WorkspacePersistenceSnapshot;
  readonly setup?: NativeSetupView;
  readonly update?: NativeUpdateView;
}) {
  const nativeAvailable = setup?.available === true;
  const shell = setup?.shell;
  const storageDegraded =
    persistence !== undefined &&
    (persistence.source !== "durable" || persistence.capsule !== "durable");
  const storageSummary =
    persistence?.source !== "durable"
      ? "Storage unavailable"
      : persistence.capsule === "session"
        ? "Session-only storage"
        : persistence.capsule === "unavailable"
          ? "Storage degraded"
          : undefined;
  const confirmShell = (action: "install" | "repair" | "remove") => {
    const message =
      action === "remove"
        ? "Remove the Flect command-line link at ~/.local/bin/flect?"
        : action === "repair"
          ? "Repair the stale Flect command-line link at ~/.local/bin/flect? Only a Flect-owned link can be replaced."
          : "Install Flect at ~/.local/bin/flect? Only an existing stale Flect-owned link can be replaced.";
    if (globalThis.confirm(message)) {
      void (action === "remove" ? setup?.removeShell() : setup?.installShell());
    }
  };
  const confirmAgent = (
    host: AgentIntegrationHost,
    action: "install" | "remove",
  ) => {
    const label = hostLabel(host);
    if (
      globalThis.confirm(
        action === "install"
          ? `Enable Flect context for ${label}? Unrelated hooks and settings will be preserved.`
          : `Remove Flect context from ${label}? Unrelated hooks and settings will be preserved.`,
      )
    ) {
      void (action === "install"
        ? setup?.installAgent(host)
        : setup?.removeAgent(host));
    }
  };
  const confirmUpdate = () => {
    const activeUpdate = update;
    const snapshot = activeUpdate?.snapshot;
    if (activeUpdate === undefined || snapshot?.state !== "available") return;
    if (
      globalThis.confirm(
        `Install Flect ${snapshot.candidate.version} and restart when it is ready? Your work and settings stay in place.`,
      )
    ) {
      void activeUpdate.install(snapshot.candidate.token);
    }
  };
  const updateSnapshot = update?.snapshot;
  const uninstall = setup?.uninstall;
  const uninstallPending =
    uninstall?.ownedIntegrations.some((item) => item.result === "pending") ===
    true;
  const confirmUninstallPreparation = () => {
    if (
      setup !== undefined &&
      globalThis.confirm(
        "Prepare Flect for removal? This disables Local control and removes only Flect-owned command and agent integrations. Your work and settings stay in place.",
      )
    ) {
      void (async () => {
        if (control.enabled) {
          await onToggleControl();
        }
        await setup.prepareUninstall();
      })();
    }
  };

  return (
    <details className="diagnostics-panel">
      {/* biome-ignore lint/a11y/useSemanticElements: summary is the native disclosure control; the explicit role keeps it exposed consistently across WebKit and JSDOM. */}
      <summary aria-label="Diagnostics" role="button">
        <span>Diagnostics</span>
        <small>
          {storageSummary !== undefined
            ? storageSummary
            : control.enabled
              ? `${control.clients.length} client${control.clients.length === 1 ? "" : "s"}`
              : "Local control off"}
        </small>
      </summary>
      <div className="diagnostics-panel__body">
        {persistence !== undefined && (
          <section
            className={`diagnostics-panel__storage${storageDegraded ? " diagnostics-panel__storage--degraded" : ""}`}
            {...(storageDegraded ? { role: "alert" as const } : {})}
          >
            <strong>Workspace storage</strong>
            <p>
              {persistence.source !== "durable"
                ? "Source history is unavailable. Flect cannot promise recovery; export what you can and reopen in a supported browser."
                : persistence.capsule === "session"
                  ? "Source history stays durable. Compiled interfaces will be lost when this Flect session closes; export before leaving."
                  : persistence.capsule === "unavailable"
                    ? "Compiled interface storage is unavailable. Source history remains durable, but previews cannot be recovered after reload."
                    : "Source history and compiled interfaces are durable in this browser."}
            </p>
          </section>
        )}
        {update !== undefined && (
          <section
            aria-busy={update.loading}
            aria-label="Flect update"
            className="diagnostics-panel__update"
          >
            <div className="diagnostics-panel__setup-heading">
              <div>
                <strong>Flect updates</strong>
                {updateSnapshot === undefined ? (
                  <p>Checking the installed version.</p>
                ) : updateSnapshot.state === "unavailable" ? (
                  <p>
                    {updateSnapshot.reason === "browser"
                      ? "Updates are available in a signed desktop release."
                      : "This development build has no trusted update key."}
                  </p>
                ) : updateSnapshot.state === "current" ? (
                  <p>Flect {updateSnapshot.installedVersion} is current.</p>
                ) : updateSnapshot.state === "available" ? (
                  <>
                    <p>Flect {updateSnapshot.candidate.version} is available</p>
                    <p>{updateSnapshot.candidate.notes}</p>
                    <p>
                      Apple silicon macOS ·{" "}
                      {updateSize(updateSnapshot.candidate.contentLength)}
                    </p>
                  </>
                ) : updateSnapshot.state === "ready-to-relaunch" ? (
                  <p>Flect {updateSnapshot.candidate.version} is ready.</p>
                ) : (
                  <p>
                    {updateSnapshot.state === "downloading"
                      ? "Downloading the verified update."
                      : "Installing the verified update."}
                  </p>
                )}
              </div>
              {updateSnapshot?.state === "current" ? (
                <button
                  disabled={update.loading}
                  onClick={() => void update.check()}
                  type="button"
                >
                  Check for updates
                </button>
              ) : updateSnapshot?.state === "available" ? (
                <button
                  disabled={update.loading}
                  onClick={confirmUpdate}
                  type="button"
                >
                  Install update
                </button>
              ) : updateSnapshot?.state === "ready-to-relaunch" ? (
                <button
                  disabled={update.loading}
                  onClick={() => void update.relaunch()}
                  type="button"
                >
                  Restart Flect
                </button>
              ) : undefined}
            </div>
            {(updateSnapshot?.state === "downloading" ||
              updateSnapshot?.state === "installing") && (
              <progress
                aria-label="Update progress"
                {...(updateSnapshot.progress.totalBytes === undefined
                  ? {}
                  : { max: updateSnapshot.progress.totalBytes })}
                value={updateSnapshot.progress.downloadedBytes}
              />
            )}
            {update.error !== undefined && (
              <p className="diagnostics-panel__setup-error" role="alert">
                {update.error}
              </p>
            )}
          </section>
        )}
        <div className="diagnostics-panel__control">
          <div>
            <strong>Local agent control</strong>
            <p>Loopback only. Access is explicit and revocable.</p>
          </div>
          <button onClick={() => void onToggleControl()} type="button">
            {control.enabled ? "Disable local control" : "Enable local control"}
          </button>
        </div>
        <section
          aria-busy={setup?.loading === true}
          aria-label="Native setup"
          className="diagnostics-panel__setup"
        >
          <div className="diagnostics-panel__setup-heading">
            <div>
              <strong>Command line</strong>
              <p>One public Flect command, linked into your local PATH.</p>
            </div>
            {!nativeAvailable ? (
              <button disabled type="button">
                Desktop app required
              </button>
            ) : shell === undefined ? (
              <button disabled type="button">
                Checking
              </button>
            ) : shell.state === "installed" ? (
              <button
                disabled={setup.loading}
                onClick={() => confirmShell("remove")}
                type="button"
              >
                Remove command-line link
              </button>
            ) : shell.state === "conflict" ? (
              <button disabled type="button">
                Existing path preserved
              </button>
            ) : (
              <button
                disabled={setup.loading}
                onClick={() =>
                  confirmShell(shell.state === "stale" ? "repair" : "install")
                }
                type="button"
              >
                {shell.state === "stale"
                  ? "Repair command-line link"
                  : "Install command-line link"}
              </button>
            )}
          </div>
          <span className="diagnostics-panel__setup-state">
            {nativeAvailable
              ? shell === undefined
                ? "Checking native state"
                : stateLabel(shell.state)
              : "Available only in the installed desktop app"}
          </span>

          <div className="diagnostics-panel__setup-heading">
            <div>
              <strong>Agent context</strong>
              <p>Opt in per host. Flect never runs an agent installer.</p>
            </div>
          </div>
          {nativeAvailable ? (
            <ul
              aria-label="Agent context integrations"
              className="diagnostics-panel__integrations"
            >
              {setup.agents.map((agent) => (
                <li key={agent.host}>
                  <div>
                    <strong>{hostLabel(agent.host)}</strong>
                    <span>{stateLabel(agent.state)}</span>
                  </div>
                  {agent.state === "installed" ? (
                    <button
                      disabled={setup.loading}
                      onClick={() => confirmAgent(agent.host, "remove")}
                      type="button"
                    >
                      Remove {hostLabel(agent.host)} context
                    </button>
                  ) : agent.state === "conflict" ? (
                    <button disabled type="button">
                      Existing config preserved
                    </button>
                  ) : (
                    <button
                      disabled={setup.loading}
                      onClick={() => confirmAgent(agent.host, "install")}
                      type="button"
                    >
                      {agent.state === "stale" ? "Repair" : "Enable"}{" "}
                      {hostLabel(agent.host)} context
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="diagnostics-panel__unavailable">
              Install the desktop app to manage agent context.
            </p>
          )}
          {setup?.error !== undefined && (
            <p className="diagnostics-panel__setup-error" role="alert">
              {setup.error}
            </p>
          )}
          {nativeAvailable && uninstall !== undefined && (
            <div className="diagnostics-panel__uninstall">
              <div className="diagnostics-panel__setup-heading">
                <div>
                  <strong>Uninstall Flect</strong>
                  <p>
                    First remove only integrations Flect still owns. Then move
                    <code>{uninstall.application.path}</code> to Trash.
                  </p>
                </div>
                <button
                  disabled={setup.loading || !uninstallPending}
                  onClick={confirmUninstallPreparation}
                  type="button"
                >
                  {uninstallPending
                    ? "Prepare to uninstall"
                    : "Integrations prepared"}
                </button>
              </div>
              <ul aria-label="Data retained after uninstall">
                {uninstall.retained.map((item) => (
                  <li key={item.kind}>
                    <strong>{retainedLabel(item.kind)}</strong>
                    <span>{item.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        {operations.length > 0 && (
          <ol
            aria-label="Recent operations"
            className="diagnostics-panel__operations"
          >
            {operations
              .slice(-20)
              .reverse()
              .map((operation) => (
                <li key={operation.sequence}>
                  <span data-phase={operation.phase}>{operation.phase}</span>
                  <strong>{operation.summary}</strong>
                  <code>{operation.operationId}</code>
                </li>
              ))}
          </ol>
        )}
      </div>
    </details>
  );
}
