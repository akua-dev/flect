/// <reference types="astro/client" />

import 'astro';

declare module 'astro' {
	interface AstroClientDirectives {
		'client:flect'?: boolean;
	}
}
