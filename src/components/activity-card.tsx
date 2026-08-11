import type { ToolActivity } from "../../shared/control";
import {
  Tool,
  ToolContent,
  ToolHeader,
  type ToolPart,
} from "./ai-elements/tool";

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

const toolState = (phase: ToolActivity["phase"]): ToolPart["state"] =>
  phase === "running"
    ? "input-available"
    : phase === "succeeded"
      ? "output-available"
      : phase === "failed"
        ? "output-error"
        : "input-streaming";

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
      <Tool className="activity-card__disclosure">
        <ToolHeader
          aria-label={`${label(activity.toolName)} details`}
          className="activity-card__summary"
          description={activity.command}
          meta={
            activity.durationMs === undefined
              ? undefined
              : `${activity.durationMs}ms`
          }
          state={toolState(activity.phase)}
          title={label(activity.toolName)}
        />
        {detail && (
          <ToolContent className="activity-card__details">
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
              <span>{phaseLabel(activity.phase)}</span>
              {activity.durationMs !== undefined && (
                <time>{`${activity.durationMs}ms`}</time>
              )}
              {activity.resultSummary !== undefined && (
                <small>{activity.resultSummary}</small>
              )}
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
          </ToolContent>
        )}
      </Tool>
      {activity.phase === "failed" && onFixInShape !== undefined && (
        <button
          className="activity-card__fix"
          onClick={() => onFixInShape(activity)}
          type="button"
        >
          Fix with Flect
        </button>
      )}
    </article>
  );
}
