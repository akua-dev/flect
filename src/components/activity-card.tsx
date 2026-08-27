import {
	CheckIcon,
	ChevronDownIcon,
	CircleIcon,
	ClockIcon,
	TerminalIcon,
	WrenchIcon,
	XIcon
} from 'lucide-react';
import type { ToolActivity } from '../../shared/control';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

const label = (toolName: string) =>
	toolName === 'bash' ? 'Bash' : toolName === 'flect' ? 'Flect' : toolName;

const phaseLabel = (phase: ToolActivity['phase']) =>
	phase === 'running'
		? 'Running'
		: phase === 'succeeded'
			? 'Completed'
			: phase === 'failed'
				? 'Failed'
				: 'Queued';

const actionLabel = (activity: ToolActivity) => {
	if (activity.toolName !== 'bash') return label(activity.toolName);
	return activity.phase === 'running'
		? 'Running command'
		: activity.phase === 'succeeded'
			? 'Ran command'
			: activity.phase === 'failed'
				? 'Command failed'
				: 'Command queued';
};

const PhaseIcon = ({ phase }: { readonly phase: ToolActivity['phase'] }) =>
	phase === 'running' ? (
		<ClockIcon />
	) : phase === 'succeeded' ? (
		<CheckIcon />
	) : phase === 'failed' ? (
		<XIcon />
	) : (
		<CircleIcon />
	);

export function ActivityCard({
	activity,
	onFixInShape
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
			<Collapsible className='activity-card__disclosure'>
				<CollapsibleTrigger
					aria-label={`${label(activity.toolName)} details`}
					className='activity-card__summary'
				>
					<span className='activity-card__tool' aria-hidden='true'>
						{activity.toolName === 'bash' ? <TerminalIcon /> : <WrenchIcon />}
					</span>
					<strong>{actionLabel(activity)}</strong>
					{activity.command !== undefined && <code>{activity.command}</code>}
					<span className='activity-card__phase'>
						<PhaseIcon phase={activity.phase} />
						<span className='sr-only'>{phaseLabel(activity.phase)}</span>
					</span>
					{activity.durationMs !== undefined && <time>{`${activity.durationMs} ms`}</time>}
					<ChevronDownIcon className='activity-card__chevron' />
				</CollapsibleTrigger>
				{detail && (
					<CollapsibleContent className='activity-card__details'>
						{activity.command !== undefined && (
							<section>
								<span>Command</span>
								<code>{activity.command}</code>
							</section>
						)}
						{activity.validationIssues !== undefined && activity.validationIssues.length > 0 && (
							<section>
								<span>Validation</span>
								<ul>
									{activity.validationIssues.map((issue) => (
										<li key={`${issue.path.join('.')}-${issue.code}`}>
											<code>{`$.${issue.path.join('.')}`}</code>
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
							{activity.durationMs !== undefined && <time>{`${activity.durationMs}ms`}</time>}
							{activity.resultSummary !== undefined && <small>{activity.resultSummary}</small>}
							{activity.exitCode !== undefined && <span>{`Exit ${activity.exitCode}`}</span>}
							<code>{activity.operationId}</code>
							{activity.previewUrl !== undefined && (
								<a href={activity.previewUrl} rel='noreferrer' target='_blank'>
									Open preview
								</a>
							)}
						</footer>
					</CollapsibleContent>
				)}
			</Collapsible>
			{activity.phase === 'failed' && onFixInShape !== undefined && (
				<button className='activity-card__fix' onClick={() => onFixInShape(activity)} type='button'>
					Fix with Flect
				</button>
			)}
		</article>
	);
}
