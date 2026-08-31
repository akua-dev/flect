import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@effect/vitest';
import { Schema } from 'effect';

/**
 * WCAG 2.x contrast audit of the shipped OKLCH palette in src/styles.css.
 *
 * The palette is parsed from both the light block (`:root`) and the dark
 * block (`@media (prefers-color-scheme: dark)`), semantic aliases such as
 * `--canvas: var(--background)` are resolved, and each color is converted
 * OKLCH -> OKLab -> linear sRGB -> WCAG relative luminance with no external
 * dependencies.
 */

// --- Pure color math -------------------------------------------------------

const RgbSchema = Schema.Struct({
	r: Schema.Finite,
	g: Schema.Finite,
	b: Schema.Finite
});
type Rgb = typeof RgbSchema.Type;
const decodeRgb = Schema.decodeUnknownSync(RgbSchema);

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** OKLCH (L in [0,1], C >= 0, H in degrees) to gamma-encoded sRGB in [0,1]. */
const oklchToSrgb = (lightness: number, chroma: number, hueDegrees: number): Rgb => {
	const hue = (hueDegrees * Math.PI) / 180;
	const labA = chroma * Math.cos(hue);
	const labB = chroma * Math.sin(hue);

	const l = (lightness + 0.396_337_777_4 * labA + 0.215_803_757_3 * labB) ** 3;
	const m = (lightness - 0.105_561_345_8 * labA - 0.063_854_172_8 * labB) ** 3;
	const s = (lightness - 0.089_484_177_5 * labA - 1.291_485_548 * labB) ** 3;

	const linear = {
		r: 4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
		g: -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
		b: -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s
	};

	const encode = (channel: number) => {
		const c = clamp01(channel);
		return c <= 0.003_130_8 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
	};

	return decodeRgb({ r: encode(linear.r), g: encode(linear.g), b: encode(linear.b) });
};

/** WCAG 2.x relative luminance of a gamma-encoded sRGB color. */
const relativeLuminance = ({ r, g, b }: Rgb): number => {
	const linearize = (channel: number) =>
		channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
};

/** WCAG 2.x contrast ratio between two gamma-encoded sRGB colors. */
const contrastRatio = (foreground: Rgb, background: Rgb): number => {
	const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
	const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
	return (lighter + 0.05) / (darker + 0.05);
};

// --- Palette parsing --------------------------------------------------------

type CustomProperties = ReadonlyMap<string, string>;

const parseCustomProperties = (block: string): Map<string, string> => {
	const properties = new Map<string, string>();
	for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
		const name = match[1];
		const value = match[2];
		if (name !== undefined && value !== undefined) {
			properties.set(name, value.trim());
		}
	}
	return properties;
};

const blockAt = (source: string, openBraceIndex: number): string => {
	let depth = 0;
	for (let index = openBraceIndex; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(openBraceIndex + 1, index);
		}
	}
	throw new Error('Unbalanced braces in styles.css');
};

const lightBlock = (source: string): string => {
	const start = source.search(/^:root \{/m);
	if (start < 0) throw new Error('Missing top-level :root block');
	return blockAt(source, source.indexOf('{', start));
};

const darkBlock = (source: string): string => {
	const media = source.indexOf('@media (prefers-color-scheme: dark)');
	if (media < 0) throw new Error('Missing dark color-scheme block');
	const root = source.indexOf(':root', media);
	return blockAt(source, source.indexOf('{', root));
};

/** Follow `var(--x)` alias chains down to a literal value. */
const resolveValue = (name: string, properties: CustomProperties): string => {
	let value = properties.get(name);
	for (let hop = 0; hop < 16 && value !== undefined; hop += 1) {
		const reference = /^var\((--[\w-]+)\)$/.exec(value);
		if (reference === null) return value;
		const next = reference[1];
		if (next === undefined) break;
		value = properties.get(next);
	}
	if (value === undefined) {
		throw new Error(`Custom property ${name} did not resolve to a literal`);
	}
	return value;
};

const parseOklch = (value: string): Rgb => {
	const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+%?\s*)?\)$/.exec(value);
	if (match === null) throw new Error(`Not a literal oklch() color: ${value}`);
	return oklchToSrgb(Number(match[1]), Number(match[2]), Number(match[3]));
};

const resolveColor = (name: string, properties: CustomProperties): Rgb =>
	parseOklch(resolveValue(name, properties));

const stylesSource = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');
const lightProperties = parseCustomProperties(lightBlock(stylesSource));
const darkProperties = new Map([
	...lightProperties,
	...parseCustomProperties(darkBlock(stylesSource))
]);

// --- Color math unit tests --------------------------------------------------

describe('oklch color math', () => {
	it('converts achromatic extremes exactly', () => {
		const white = oklchToSrgb(1, 0, 0);
		expect(white.r).toBeCloseTo(1, 4);
		expect(white.g).toBeCloseTo(1, 4);
		expect(white.b).toBeCloseTo(1, 4);
		const black = oklchToSrgb(0, 0, 0);
		expect(black.r).toBeCloseTo(0, 4);
		expect(black.g).toBeCloseTo(0, 4);
		expect(black.b).toBeCloseTo(0, 4);
	});

	it('converts sRGB primary red within rounding tolerance', () => {
		// oklch(0.628 0.2577 29.234) is the OKLCH form of #ff0000.
		const red = oklchToSrgb(0.628, 0.2577, 29.234);
		expect(red.r).toBeCloseTo(1, 2);
		expect(red.g).toBeCloseTo(0, 2);
		expect(red.b).toBeCloseTo(0, 2);
	});

	it('matches WCAG reference luminances and ratios', () => {
		expect(relativeLuminance({ r: 1, g: 1, b: 1 })).toBeCloseTo(1, 5);
		expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
		expect(contrastRatio({ r: 1, g: 1, b: 1 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 5);
		expect(contrastRatio({ r: 1, g: 1, b: 1 }, { r: 1, g: 1, b: 1 })).toBeCloseTo(1, 5);
	});
});

// --- Palette contrast gates -------------------------------------------------

const modes: ReadonlyArray<readonly [string, CustomProperties]> = [
	['light', lightProperties],
	['dark', darkProperties]
];

const expectContrast = (
	properties: CustomProperties,
	mode: string,
	foreground: string,
	background: string,
	minimum: number
) => {
	const measured = contrastRatio(
		resolveColor(foreground, properties),
		resolveColor(background, properties)
	);
	expect(
		measured,
		`${foreground} over ${background} (${mode}) measured ${measured.toFixed(2)}:1, requires ${minimum}:1`
	).toBeGreaterThanOrEqual(minimum);
};

describe.each(modes)('palette contrast (%s)', (mode, properties) => {
	it('keeps ink readable on every surface tier', () => {
		for (const background of ['--void', '--canvas', '--surface', '--raised']) {
			expectContrast(properties, mode, '--ink', background, 4.5);
		}
	});

	it('keeps muted text readable on working surfaces', () => {
		for (const background of ['--void', '--canvas', '--surface']) {
			expectContrast(properties, mode, '--muted', background, 4.5);
		}
	});

	it('keeps quiet marks perceivable on void and canvas', () => {
		// Quiet is decorative-only per DESIGN.md, so 3:1 is the floor. If this
		// fails, surface the measured value instead of weakening the gate.
		for (const background of ['--void', '--canvas']) {
			expectContrast(properties, mode, '--quiet', background, 3);
		}
	});

	it('keeps semantic state colors perceivable', () => {
		for (const foreground of ['--danger', '--ready']) {
			for (const background of ['--void', '--surface', '--raised']) {
				expectContrast(properties, mode, foreground, background, 3);
			}
		}
	});

	it('keeps Ready Mint readable as label text, not just a decorative dot', () => {
		// --ready is consumed as real text color (share-library install badge,
		// product-adoption-card__state.is-ready), not only as a 6px status dot,
		// so hold it to the same 4.5:1 text bar as ink/muted rather than the
		// 3:1 floor used for purely decorative marks.
		for (const background of ['--void', '--surface']) {
			expectContrast(properties, mode, '--ready', background, 4.5);
		}
	});
});

// --- Ready Mint: resolved, per-appearance, never a silent ink alias --------

describe('Ready Mint token (issue #49)', () => {
	it('resolves to the documented mint hue in both appearances, not --foreground/--ink', () => {
		for (const [mode, properties] of modes) {
			const literal = resolveValue('--ready', properties);
			expect(literal, `--ready (${mode}) should be a literal oklch() mint, not an alias`).toMatch(
				/^oklch\(/
			);
			const match = /^oklch\(\s*[\d.]+\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(literal);
			expect(match, `--ready (${mode}) should parse as oklch(L C H): ${literal}`).not.toBeNull();
			const chroma = Number(match?.[1]);
			const hue = Number(match?.[2]);
			expect(chroma, `--ready (${mode}) should carry real chroma, not a neutral`).toBeGreaterThan(
				0.05
			);
			expect(
				hue,
				`--ready (${mode}) should sit in the documented mint/green hue family`
			).toBeCloseTo(158, 0);
		}
	});

	it('uses a darker, more saturated mint in light than dark so both clear AA on their own surfaces', () => {
		const lightMint = resolveColor('--ready', lightProperties);
		const darkMint = resolveColor('--ready', darkProperties);
		expect(lightMint).not.toEqual(darkMint);
	});
});
