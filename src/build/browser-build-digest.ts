const encoder = new TextEncoder();

export const digestBuildEntries = async (
	entries: ReadonlyArray<{
		readonly path: string;
		readonly contents: Uint8Array;
	}>
) => {
	const parts: Array<Uint8Array> = [];
	let length = 0;
	for (const entry of entries.toSorted((left, right) => left.path.localeCompare(right.path))) {
		const header = encoder.encode(`${entry.path}\0${entry.contents.byteLength}\0`);
		parts.push(header, entry.contents);
		length += header.byteLength + entry.contents.byteLength;
	}
	const input = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		input.set(part, offset);
		offset += part.byteLength;
	}
	const digest = await crypto.subtle.digest('SHA-256', input);
	return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
};

export const digestBuildBytes = async (contents: Uint8Array) => {
	const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(contents).buffer);
	return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
};
