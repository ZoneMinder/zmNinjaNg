/**
 * Minimal Markdown Renderer
 *
 * Renders the small subset of Markdown used in developer notices:
 *   **bold**, *italic*, `code`, [text](url), bullet lists (- or *),
 *   blank-line-separated paragraphs.
 *
 * Avoids a new react-markdown dependency. Not a general-purpose renderer.
 * URLs in links are passed through verbatim; rendered with rel="noreferrer"
 * and target="_blank" so notice links open without navigating away.
 */

import type { ReactNode } from 'react';

/** Split body into blocks separated by one or more blank lines. */
function splitBlocks(body: string): string[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * Render inline formatting (bold/italic/code/links) inside a single block of
 * text. We scan left-to-right and emit a flat array of strings + elements.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: links first (they can contain * and `), then code, bold,
  // italic. Single regex with named alternatives keeps things linear.
  const pattern = /(\[[^\]]+\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${idx++}`;
    if (token.startsWith('[')) {
      const closeBracket = token.indexOf(']');
      const label = token.slice(1, closeBracket);
      const href = token.slice(closeBracket + 2, -1);
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" className="text-primary underline hover:opacity-80">
          {label}
        </a>,
      );
    } else if (token.startsWith('`')) {
      out.push(
        <code key={key} className="px-1 py-0.5 rounded bg-muted text-[0.9em] font-mono">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = splitBlocks(source);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, bi) => {
        // Bullet list: every non-empty line starts with "- " or "* "
        const lines = block.split('\n');
        const isList = lines.length > 0 && lines.every((l) => /^\s*[-*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={bi} className="list-disc list-outside pl-5 space-y-1">
              {lines.map((line, li) => (
                <li key={li}>{renderInline(line.replace(/^\s*[-*]\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        // Normal paragraph; preserve single newlines as line breaks
        return (
          <p key={bi}>
            {lines.map((line, li) => (
              <span key={li}>
                {renderInline(line, `${bi}-${li}`)}
                {li < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
