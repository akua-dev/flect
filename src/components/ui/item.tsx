import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/class-names';

// ItemGroup is a real <ul> (not a <div role="list">): the native element
// already implies list semantics, so nothing extra needs announcing to
// assistive tech. Item/ItemSeparator read this context to render as valid
// <ul> children (<li>) only while actually inside a group -- both also
// support standalone use outside ItemGroup (matching upstream shadcn's
// Item, which is documented both ways), where they keep rendering their
// plain, non-list element.
const ItemGroupContext = React.createContext(false);

function ItemGroup({ className, ...props }: React.ComponentProps<'ul'>) {
	return (
		<ItemGroupContext.Provider value={true}>
			<ul
				data-slot='item-group'
				className={cn(
					'group/item-group flex w-full flex-col gap-4 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2',
					className
				)}
				{...props}
			/>
		</ItemGroupContext.Provider>
	);
}

function ItemSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
	const separator = (
		<Separator
			data-slot='item-separator'
			orientation='horizontal'
			className={cn('my-2', className)}
			{...props}
		/>
	);
	// <ul>'s content model only permits <li> (plus script-supporting
	// elements) as direct children -- wrap the separator in one when it's
	// actually a sibling of <li>-rendering Items inside an ItemGroup.
	return React.useContext(ItemGroupContext) ? <li aria-hidden='true'>{separator}</li> : separator;
}

const itemVariants = cva(
	'group/item flex w-full flex-wrap items-center rounded-lg border text-sm transition-colors duration-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [a]:transition-colors [a]:hover:bg-muted',
	{
		variants: {
			variant: {
				default: 'border-transparent',
				outline: 'border-border',
				muted: 'border-transparent bg-muted/50'
			},
			size: {
				default: 'gap-2.5 px-3 py-2.5',
				sm: 'gap-2.5 px-3 py-2.5',
				xs: 'gap-2 px-2.5 py-2 in-data-[slot=dropdown-menu-content]:p-0'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	}
);

function Item({
	className,
	variant = 'default',
	size = 'default',
	asChild = false,
	...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemVariants> & { asChild?: boolean }) {
	const inGroup = React.useContext(ItemGroupContext);
	const Comp: React.ElementType = asChild ? Slot.Root : inGroup ? 'li' : 'div';
	return (
		<Comp
			data-slot='item'
			data-variant={variant}
			data-size={size}
			className={cn(itemVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

const itemMediaVariants = cva(
	'flex shrink-0 items-center justify-center gap-2 group-has-data-[slot=item-description]/item:translate-y-0.5 group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none',
	{
		variants: {
			variant: {
				default: 'bg-transparent',
				icon: "[&_svg:not([class*='size-'])]:size-4",
				image:
					'size-10 overflow-hidden rounded-sm group-data-[size=sm]/item:size-8 group-data-[size=xs]/item:size-6 [&_img]:size-full [&_img]:object-cover'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	}
);

function ItemMedia({
	className,
	variant = 'default',
	...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemMediaVariants>) {
	return (
		<div
			data-slot='item-media'
			data-variant={variant}
			className={cn(itemMediaVariants({ variant, className }))}
			{...props}
		/>
	);
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot='item-content'
			className={cn(
				'flex flex-1 flex-col gap-1 group-data-[size=xs]/item:gap-0 [&+[data-slot=item-content]]:flex-none',
				className
			)}
			{...props}
		/>
	);
}

function ItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot='item-title'
			className={cn(
				'line-clamp-1 flex w-fit items-center gap-2 text-sm leading-snug font-medium underline-offset-4',
				className
			)}
			{...props}
		/>
	);
}

function ItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
	return (
		<p
			data-slot='item-description'
			className={cn(
				'line-clamp-2 text-left text-sm leading-normal font-normal text-muted-foreground group-data-[size=xs]/item:text-xs [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
				className
			)}
			{...props}
		/>
	);
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div data-slot='item-actions' className={cn('flex items-center gap-2', className)} {...props} />
	);
}

function ItemHeader({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot='item-header'
			className={cn('flex basis-full items-center justify-between gap-2', className)}
			{...props}
		/>
	);
}

function ItemFooter({ className, ...props }: React.ComponentProps<'div'>) {
	return (
		<div
			data-slot='item-footer'
			className={cn('flex basis-full items-center justify-between gap-2', className)}
			{...props}
		/>
	);
}

export {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemGroup,
	ItemHeader,
	ItemMedia,
	ItemSeparator,
	ItemTitle
};
