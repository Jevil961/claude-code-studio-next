import { text } from "./i18n.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseAlignments(line) {
  return splitTableRow(line).map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });
}

function isTableStart(lines, index) {
  return lines[index]?.includes("|") && isTableSeparator(lines[index + 1] || "");
}

function renderTable(lines, start) {
  const header = splitTableRow(lines[start]);
  const aligns = parseAlignments(lines[start + 1] || "");
  const rows = [];
  let index = start + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }
  const head = header.map((cell, i) => {
    const style = aligns[i] && aligns[i] !== "left" ? ` style="text-align:${aligns[i]}"` : "";
    return `<th${style}>${renderInlineMarkdown(cell)}</th>`;
  }).join("");
  const body = rows.map((row) => {
    const cells = header.map((_cell, cellIndex) => {
      const style = aligns[cellIndex] && aligns[cellIndex] !== "left" ? ` style="text-align:${aligns[cellIndex]}"` : "";
      return `<td${style}>${renderInlineMarkdown(row[cellIndex] || "")}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return {
    html: `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: index
  };
}

function normalizeMarkdown(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\|\s*\|(?=\s*:?-{3,})/g, "|\n|");
}

function flushParagraph(parts, out) {
  if (!parts.length) return;
  out.push(`<p>${renderInlineMarkdown(parts.join(" "))}</p>`);
  parts.length = 0;
}

export function renderMarkdown(value) {
  const lines = normalizeMarkdown(value).split("\n");
  const out = [];
  const paragraph = [];
  let list = [];
  let listTag = "ul";
  let quote = [];
  let inCode = false;
  let code = [];
  let codeLang = "";

  const flushList = () => {
    if (!list.length) return;
    out.push(`<${listTag}>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${listTag}>`);
    list = [];
    listTag = "ul";
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${quote.map((item) => renderInlineMarkdown(item)).join("<br>")}</blockquote>`);
    quote = [];
  };
  const flushBlocks = () => {
    flushParagraph(paragraph, out);
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```([\w-]*)/);
    if (fence) {
      if (inCode) {
        const codeText = escapeHtml(code.join("\n"));
        const langLabel = codeLang || text.code;
        out.push(`<div class="code-block"><div class="code-head"><span>${langLabel}</span><button type="button" class="copy-code">${text.copy}</button></div><pre><code>${codeText}</code></pre></div>`);
        code = [];
        codeLang = "";
        inCode = false;
      } else {
        flushBlocks();
        inCode = true;
        codeLang = fence[1] || "";
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushBlocks();
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      flushBlocks();
      out.push("<hr>");
      continue;
    }
    if (isTableStart(lines, index)) {
      flushBlocks();
      const table = renderTable(lines, index);
      out.push(table.html);
      index = table.next - 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      out.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const quoteLine = line.match(/^\s*>\s?(.+)$/);
    if (quoteLine) {
      flushParagraph(paragraph, out);
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph(paragraph, out);
      flushQuote();
      const nextTag = ordered ? "ol" : "ul";
      if (list.length && listTag !== nextTag) flushList();
      listTag = nextTag;
      list.push((unordered || ordered)[1]);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  if (inCode) {
    const codeText = escapeHtml(code.join("\n"));
    out.push(`<div class="code-block"><div class="code-head"><span>${codeLang || text.code}</span><button type="button" class="copy-code">${text.copy}</button></div><pre><code>${codeText}</code></pre></div>`);
  }
  flushBlocks();
  return out.join("");
}
