import type { ToolActivity } from "../../shared/control";

const label = (toolName: string) =>
  toolName === "bash" ? "Bash" : toolName === "flect" ? "Flect" : toolName;

const phaseLabel = (phase: ToolActivity["phase"]) =>
  phase === "running"
    ? "Running"
    : phase === "succeeded"
      ? "Completed"
      : phase === "failed"
        ? "Failed"
        : "Queued";

export function ActivityCard({
  activity,
  onFixInShape,
}: {
  readonly activity: ToolActivity;
  readonly onFixInShape?: (activity: ToolActivity) => void;
}) {
  const detail =
    activity.command !== undefined ||
    activity.output !== undefined ||
    activity.exitCode !== undefined ||
    activity.previewUrl !== undefined ||
    (activity.validationIssues?.length ?? 0) > 0;

  return (
    <article className={`activity-card activity-card--${activity.phase}`}>
      <details className="activity-card__disclosure">
        {/* biome-ignore lint/a11y/useSemanticElements: summary is the native disclosure control; the explicit role keeps it exposed consistently across WebKit and JSDOM. */}
        <summary
          aria-label={`${label(activity.toolName)} details`}
          className="activity-card__summary"
          role="button"
        >
          <span aria-hidden="true" className="activity-card__dot" />
          <strong>{label(activity.toolName)}</strong>
          <span>{phaseLabel(activity.phase)}</span>
          {activity.durationMs !== undefined && (
            <time>{`${activity.durationMs}ms`}</time>
          )}
          {!detail && activity.resultSummary !== undefined && (
            <small>{activity.resultSummary}</small>
          )}
        </summary>
        {detail && (
          <div className="activity-card__details">
            {activity.command !== undefined && (
              <section>
                <span>Command</span>
                <code>{activity.command}</code>
              </section>
            )}
            {activity.validationIssues !== undefined &&
              activity.validationIssues.length > 0 && (
                <section>
                  <span>Validation</span>
                  <ul>
                    {activity.validationIssues.map((issue) => (
                      <li key={`${issue.path.join(".")}-${issue.code}`}>
                        <code>{`$.${issue.path.join(".")}`}</code>
                        <span>{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            {activity.output !== undefined && (
              <section>
                <span>Output</span>
                <pre>{activity.output}</pre>
              </section>
            )}
            <footer>
              {activity.exitCode !== undefined && (
                <span>{`Exit ${activity.exitCode}`}</span>
              )}
              <code>{activity.operationId}</code>
              {activity.previewUrl !== undefined && (
                <a href={activity.previewUrl} rel="noreferrer" target="_blank">
                  Open preview
                </a>
              )}
            </footer>
          </div>
        )}
      </details>
      {activity.phase === "failed" && onFixInShape !== undefined && (
        <button
          className="activity-card__fix"
          onClick={() => onFixInShape(activity)}
          type="button"
        >
          Fix in Shape
        </button>
      )}
    </article>
  );
}
