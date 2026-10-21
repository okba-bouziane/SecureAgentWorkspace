export interface Chunk {
  ordinal: number;
  content: string;
}

export interface ChunkOptions {
  maxChars?: number;
}

/**
 * Markdown-aware chunking: paragraphs are packed up to maxChars and every
 * chunk keeps the nearest heading as a prefix so it stays understandable alone.
 */
export function chunkMarkdown(title: string, markdown: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 800;
  const blocks = markdown.replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let heading = "";
  let buffer = "";

  const flush = () => {
    const body = buffer.trim();
    if (body) {
      const prefix = heading && heading !== title ? `${title} > ${heading}\n` : `${title}\n`;
      chunks.push({ ordinal: chunks.length, content: `${prefix}${body}` });
    }
    buffer = "";
  };

  for (const block of blocks) {
    const h = block.match(/^#{1,6}\s+(.*)$/m);
    if (h && block.startsWith("#") && !block.includes("\n")) {
      flush();
      heading = (h[1] ?? "").trim();
      continue;
    }
    for (const piece of splitLong(block, maxChars)) {
      if (buffer && buffer.length + piece.length + 2 > maxChars) flush();
      buffer += (buffer ? "\n\n" : "") + piece;
    }
  }
  flush();
  return chunks;
}

function splitLong(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];
  const sentences = block.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > maxChars) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? " " : "") + s;
  }
  if (cur) out.push(cur);
  return out;
}
