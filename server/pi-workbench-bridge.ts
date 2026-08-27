import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { InterfaceEditRequested } from '../shared/contracts';

export const makePiWorkbenchBridge = (emit: (event: InterfaceEditRequested) => void) => {
	const tool = defineTool({
		name: 'request_interface_edit',
		label: 'Shape interface',
		description:
			'Request a visible handoff to Flect Shaper when the user clearly wants the interface changed. Do not use this for questions or ordinary product actions.',
		promptSnippet: 'Request an explicit, visible handoff to Shaper for interface changes.',
		promptGuidelines: [
			'Use request_interface_edit only for a clear request to change the interface.',
			'Answer questions and perform ordinary product use without requesting Shape.'
		],
		parameters: Type.Object(
			{
				instruction: Type.String({
					minLength: 1,
					maxLength: 4_000,
					description: "The user's concrete interface-change instruction for Shaper."
				})
			},
			{ additionalProperties: false }
		),
		executionMode: 'sequential',
		execute: async (toolCallId, params) => {
			emit(
				InterfaceEditRequested.make({
					type: 'interface_edit_requested',
					requestId: toolCallId,
					instruction: params.instruction
				})
			);
			return {
				content: [
					{
						type: 'text' as const,
						text: 'Flect will switch this request to Shaper through the protected workbench.'
					}
				],
				details: { requested: true }
			};
		}
	});

	return { tool };
};
