interface TextBlock {
  readonly kind: "text";
  readonly content: string;
  readonly offset: number;
}

interface CodeBlock {
  readonly kind: "code";
  readonly content: string;
  readonly language: string | undefined;
  readonly offset: number;
}

type MessageBlock = TextBlock | CodeBlock;

function appendText(
  blocks: Array<MessageBlock>,
  content: string,
  offset: number,
) {
  const text = content.trim();
  if (text.length > 0) {
    blocks.push({ kind: "text", content: text, offset });
  }
}

function messageBlocks(content: string): ReadonlyArray<MessageBlock> {
  const blocks: Array<MessageBlock> = [];
  let cursor = 0;

  while (cursor < content.length) {
    const fenceStart = content.indexOf("```", cursor);
    if (fenceStart === -1) {
      appendText(blocks, content.slice(cursor), cursor);
      break;
    }

    const headerEnd = content.indexOf("\n", fenceStart + 3);
    if (headerEnd === -1) {
      appendText(blocks, content.slice(cursor), cursor);
      break;
    }

    appendText(blocks, content.slice(cursor, fenceStart), cursor);
    const language =
      content.slice(fenceStart + 3, headerEnd).trim() || undefined;
    const codeStart = headerEnd + 1;
    const fenceEnd = content.indexOf("```", codeStart);

    if (fenceEnd === -1) {
      blocks.push({
        kind: "code",
        content: content.slice(codeStart).trimEnd(),
        language,
        offset: fenceStart,
      });
      break;
    }

    blocks.push({
      kind: "code",
      content: content.slice(codeStart, fenceEnd).trimEnd(),
      language,
      offset: fenceStart,
    });
    cursor = fenceEnd + 3;
  }

  return blocks;
}

function TextContent({ content }: { readonly content: string }) {
  return <p>{content.trim()}</p>;
}

export function MessageContent({ content }: { readonly content: string }) {
  return (
    <div className="message-content">
      {messageBlocks(content).map((block) =>
        block.kind === "code" ? (
          <pre key={`code:${block.offset}`}>
            <code data-language={block.language}>{block.content}</code>
          </pre>
        ) : (
          <TextContent content={block.content} key={`text:${block.offset}`} />
        ),
      )}
    </div>
  );
}
