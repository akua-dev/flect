import {
	Component,
	type ReactElement,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useMemo
} from 'react';
import ReactMarkdown, {
	type Components,
	type Options as ReactMarkdownOptions
} from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { MarkdownCodeBlock } from './markdown-code-block';
import {
	extractFenceLanguage,
	extractFenceTitle,
	isExternalMarkdownHref,
	markdownUrlTransform
} from './markdown-policy';
import { MarkdownTable } from './markdown-table';

type MarkdownAstNode = {
	readonly type?: string;
	readonly meta?: unknown;
	data?: {
		hProperties?: Record<string, unknown>;
	};
	readonly children?: ReadonlyArray<MarkdownAstNode>;
};

const remarkPreserveCodeMeta = () => (tree: MarkdownAstNode) => {
	const visit = (node: MarkdownAstNode) => {
		if (node.type === 'code' && typeof node.meta === 'string' && node.meta.trim().length > 0) {
			node.data = {
				...node.data,
				hProperties: {
					...node.data?.hProperties,
					dataCodeMeta: node.meta.trim()
				}
			};
		}
		node.children?.forEach(visit);
	};

	visit(tree);
};

const FLECT_MARKDOWN_SANITIZE_SCHEMA = {
	clobberPrefix: '',
	tagNames: [
		'a',
		'blockquote',
		'br',
		'code',
		'del',
		'details',
		'div',
		'em',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'hr',
		'input',
		'li',
		'ol',
		'p',
		'pre',
		'section',
		'span',
		'strong',
		'sub',
		'summary',
		'sup',
		'table',
		'tbody',
		'td',
		'tfoot',
		'th',
		'thead',
		'tr',
		'ul'
	],
	attributes: {
		'*': ['dir', 'lang'],
		a: [
			'ariaDescribedBy',
			'ariaLabel',
			'ariaLabelledBy',
			'dataFootnoteBackref',
			'dataFootnoteRef',
			['className', 'data-footnote-backref'],
			['id', /^user-content-fnref-\d+(?:-\d+)?$/],
			'role',
			'href'
		],
		code: [['className', /^language-[\w+#.-]+$/], 'dataCodeMeta'],
		details: ['open'],
		input: [
			['checked', true],
			['disabled', true],
			['type', 'checkbox']
		],
		h2: [
			['className', 'sr-only'],
			['id', 'footnote-label']
		],
		li: [
			['className', 'task-list-item'],
			['id', /^user-content-fn-\d+(?:-\d+)?$/]
		],
		ol: [['className', 'contains-task-list'], 'start'],
		section: ['dataFootnotes', ['className', 'footnotes'], 'role'],
		summary: ['ariaDescribedBy', 'ariaLabel', 'ariaLabelledBy'],
		table: ['ariaDescribedBy', 'ariaLabel', 'ariaLabelledBy'],
		td: ['align', 'colSpan', 'headers', 'rowSpan'],
		th: ['align', 'colSpan', 'headers', 'rowSpan', 'scope'],
		ul: [['className', 'contains-task-list']]
	},
	protocols: {
		href: ['http', 'https', 'mailto']
	}
} satisfies Parameters<typeof rehypeSanitize>[0];

const REMARK_PLUGINS = [remarkGfm, remarkPreserveCodeMeta] satisfies NonNullable<
	ReactMarkdownOptions['remarkPlugins']
>;

const REMARK_PLUGINS_WITH_BREAKS = [
	remarkGfm,
	remarkBreaks,
	remarkPreserveCodeMeta
] satisfies NonNullable<ReactMarkdownOptions['remarkPlugins']>;

const REHYPE_PLUGINS = [
	rehypeRaw,
	[rehypeSanitize, FLECT_MARKDOWN_SANITIZE_SCHEMA]
] satisfies NonNullable<ReactMarkdownOptions['rehypePlugins']>;

const handleMarkdownFragment = (event: ReactMouseEvent<HTMLAnchorElement>, href: string) => {
	if (
		!href.startsWith('#') ||
		href.length === 1 ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey
	) {
		return;
	}

	let id: string;
	try {
		id = decodeURIComponent(href.slice(1));
	} catch {
		return;
	}
	const root = event.currentTarget.closest('.message-content');
	const localTarget = Array.from(root?.querySelectorAll<HTMLElement>('[id]') ?? []).find(
		(candidate) => candidate.id === id
	);
	const target = localTarget ?? document.getElementById(id);
	if (target === null) {
		return;
	}

	event.preventDefault();
	target.scrollIntoView({ block: 'nearest' });
};

const MarkdownLink: NonNullable<Components['a']> = ({ children, href = '', ...props }) => {
	const { node: _node, ...elementProps } = props;
	const role =
		'data-footnote-ref' in elementProps
			? 'doc-noteref'
			: 'data-footnote-backref' in elementProps
				? 'doc-backlink'
				: elementProps.role;
	if (href.length === 0) {
		return <span>{children}</span>;
	}
	if (isExternalMarkdownHref(href)) {
		return (
			<a {...elementProps} href={href} rel='noopener noreferrer' role={role} target='_blank'>
				{children}
			</a>
		);
	}
	return (
		<a
			{...elementProps}
			href={href}
			onClick={(event) => handleMarkdownFragment(event, href)}
			role={role}
		>
			{children}
		</a>
	);
};

const MarkdownDetails: NonNullable<Components['details']> = ({ children, open }) => (
	<details className='markdown-details' open={open}>
		{children}
	</details>
);

const MarkdownSection: NonNullable<Components['section']> = ({ children, ...props }) => {
	const { node: _node, ...elementProps } = props;
	const role = 'data-footnotes' in elementProps ? 'doc-endnotes' : elementProps.role;
	return (
		<section {...elementProps} role={role}>
			{children}
		</section>
	);
};

const MarkdownCode: NonNullable<Components['code']> = ({ children, className, ...props }) => {
	const { node: _node, ...elementProps } = props;
	const language = className === undefined ? undefined : extractFenceLanguage(className);
	return (
		<code {...elementProps} className={className} data-language={language}>
			{children}
		</code>
	);
};

interface HastTextNode {
	readonly type?: string;
	readonly value?: unknown;
}

interface HastElementNode {
	readonly type?: string;
	readonly tagName?: string;
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly children?: ReadonlyArray<HastTextNode>;
}

const extractPreCode = (
	node: unknown
):
	| {
			readonly code: string;
			readonly language: string;
			readonly title?: string;
	  }
	| undefined => {
	const codeNode = (node as HastElementNode | undefined)?.children?.find(
		(child) =>
			(child as HastElementNode).type === 'element' && (child as HastElementNode).tagName === 'code'
	) as HastElementNode | undefined;
	if (codeNode === undefined) {
		return undefined;
	}

	const classProperty = codeNode.properties?.className;
	const className = Array.isArray(classProperty)
		? classProperty.filter((value): value is string => typeof value === 'string').join(' ')
		: typeof classProperty === 'string'
			? classProperty
			: undefined;
	const meta = codeNode.properties?.dataCodeMeta;
	const code = (codeNode.children ?? [])
		.map((child) => (typeof child.value === 'string' ? child.value : ''))
		.join('');

	return {
		code,
		language: extractFenceLanguage(className),
		title: extractFenceTitle(typeof meta === 'string' ? meta : undefined)
	};
};

const BASE_MARKDOWN_COMPONENTS = {
	a: MarkdownLink,
	code: MarkdownCode,
	details: MarkdownDetails,
	section: MarkdownSection,
	table: MarkdownTable
} satisfies Components;

const markdownComponents = (streaming: boolean): Components => ({
	...BASE_MARKDOWN_COMPONENTS,
	pre: ({ children, node }) => {
		const code = extractPreCode(node);
		if (code === undefined) {
			return <pre>{children}</pre>;
		}
		return (
			<MarkdownCodeBlock
				code={code.code}
				language={code.language}
				streaming={streaming}
				title={code.title}
			/>
		);
	}
});

class MarkdownErrorBoundary extends Component<
	{ readonly children: ReactNode; readonly fallback: ReactNode },
	{ readonly failed: boolean }
> {
	override state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	override render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

export interface MessageContentProps {
	readonly content: string;
	readonly messageRole: 'user' | 'assistant' | 'activity';
	readonly streaming?: boolean;
}

export function MessageContent({
	content,
	messageRole,
	streaming = false
}: MessageContentProps): ReactElement {
	const remarkPlugins = messageRole === 'assistant' ? REMARK_PLUGINS : REMARK_PLUGINS_WITH_BREAKS;
	const components = useMemo(() => markdownComponents(streaming), [streaming]);

	return (
		<div className='message-content' data-message-role={messageRole}>
			<MarkdownErrorBoundary
				fallback={<p className='message-content__fallback'>{content}</p>}
				key={content}
			>
				<ReactMarkdown
					components={components}
					rehypePlugins={REHYPE_PLUGINS}
					remarkPlugins={remarkPlugins}
					urlTransform={markdownUrlTransform}
				>
					{content}
				</ReactMarkdown>
			</MarkdownErrorBoundary>
		</div>
	);
}
