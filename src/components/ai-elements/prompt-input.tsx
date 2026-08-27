'use client';

import { CornerDownLeftIcon, SquareIcon, XIcon } from 'lucide-react';
import type {
	ComponentProps,
	FormEvent,
	FormEventHandler,
	HTMLAttributes,
	KeyboardEventHandler
} from 'react';
import { useCallback, useState } from 'react';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea
} from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/class-names';

export interface PromptInputMessage {
	text: string;
	files: readonly never[];
}

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
	onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void;
};

export const PromptInput = ({ className, onSubmit, children, ...props }: PromptInputProps) => {
	const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
		(event) => {
			event.preventDefault();
			const formData = new FormData(event.currentTarget);
			const message = formData.get('message');
			onSubmit(
				{
					files: [],
					text: typeof message === 'string' ? message : ''
				},
				event
			);
		},
		[onSubmit]
	);

	return (
		<form className={cn('w-full', className)} onSubmit={handleSubmit} {...props}>
			<InputGroup className='overflow-visible'>{children}</InputGroup>
		</form>
	);
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
	<div className={cn('contents', className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>;

export const PromptInputTextarea = ({
	onKeyDown,
	className,
	placeholder = 'What would you like to know?',
	...props
}: PromptInputTextareaProps) => {
	const [isComposing, setIsComposing] = useState(false);

	const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
		(event) => {
			onKeyDown?.(event);
			if (
				event.defaultPrevented ||
				event.key !== 'Enter' ||
				event.shiftKey ||
				isComposing ||
				event.nativeEvent.isComposing
			) {
				return;
			}
			event.preventDefault();
			const submitButton =
				event.currentTarget.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
			if (submitButton?.disabled !== true) {
				event.currentTarget.form?.requestSubmit();
			}
		},
		[isComposing, onKeyDown]
	);

	return (
		<InputGroupTextarea
			className={cn('field-sizing-content max-h-48 min-h-16', className)}
			name='message'
			onCompositionEnd={() => setIsComposing(false)}
			onCompositionStart={() => setIsComposing(true)}
			onKeyDown={handleKeyDown}
			placeholder={placeholder}
			{...props}
		/>
	);
};

export type PromptInputFooterProps = Omit<ComponentProps<typeof InputGroupAddon>, 'align'>;

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
	<InputGroupAddon
		align='block-end'
		className={cn('justify-between gap-1', className)}
		{...props}
	/>
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
	<div className={cn('flex min-w-0 items-center gap-1', className)} {...props} />
);

export type PromptInputStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
	status?: PromptInputStatus;
	onStop?: () => void;
};

export const PromptInputSubmit = ({
	className,
	variant = 'default',
	size = 'icon-sm',
	status,
	onStop,
	onClick,
	children,
	...props
}: PromptInputSubmitProps) => {
	const isGenerating = status === 'submitted' || status === 'streaming';
	const handleClick = useCallback(
		(event: React.MouseEvent<HTMLButtonElement>) => {
			if (isGenerating && onStop) {
				event.preventDefault();
				onStop();
				return;
			}
			onClick?.(event);
		},
		[isGenerating, onClick, onStop]
	);

	let icon = <CornerDownLeftIcon className='size-4' />;
	if (status === 'submitted') icon = <Spinner />;
	if (status === 'streaming') icon = <SquareIcon className='size-4' />;
	if (status === 'error') icon = <XIcon className='size-4' />;

	return (
		<InputGroupButton
			aria-label={isGenerating ? 'Stop' : 'Submit'}
			className={cn(className)}
			onClick={handleClick}
			size={size}
			type={isGenerating && onStop ? 'button' : 'submit'}
			variant={variant}
			{...props}
		>
			{children ?? icon}
		</InputGroupButton>
	);
};
