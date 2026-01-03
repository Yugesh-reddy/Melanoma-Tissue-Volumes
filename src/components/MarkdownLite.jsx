import React from 'react';

// Minimal markdown renderer for the streaming AI narrative.
// Supports: # / ## / ### headings, **bold**, *italic*, `code`, bullet lists
// (-, *), numbered lists, GitHub-style tables, horizontal rules (---), and
// paragraphs. Intentionally tiny — no external dependency, which keeps the
// GitHub-Pages build and the Google-Drive dev mount friction-free.

const renderInline = (text, keyPrefix) => {
  // Split on **bold**, *italic*, and `code` spans, keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-b-${i}`} style={{ color: '#fff', fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={`${keyPrefix}-i-${i}`}>{part.slice(1, -1)}</em>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={`${keyPrefix}-c-${i}`}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.85em',
            background: 'rgba(255,255,255,0.08)',
            padding: '1px 4px',
            borderRadius: '4px',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t-${i}`}>{part}</React.Fragment>;
  });
};

// Split a table row into trimmed cells, dropping the outer pipes.
const parseRow = (line) => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
};

// A separator row is | --- | :--: | --- | etc.
const isSeparatorRow = (line) =>
  /\|/.test(line) && parseRow(line).every((c) => /^:?-{1,}:?$/.test(c));

const isTableRow = (line) => line.includes('|');

const MarkdownLite = ({ text = '' }) => {
  const lines = text.split('\n');
  const blocks = [];
  let list = null; // { ordered: bool, items: [] }

  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={`list-${blocks.length}`} style={{ margin: '4px 0 8px', paddingLeft: '18px' }}>
          {list.items.map((item, i) => (
            <li key={i} style={{ marginBottom: '3px' }}>
              {renderInline(item, `li-${blocks.length}-${i}`)}
            </li>
          ))}
        </Tag>
      );
      list = null;
    }
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx];
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    // Table: a row followed by a separator row.
    if (
      isTableRow(trimmed) &&
      idx + 1 < lines.length &&
      isSeparatorRow(lines[idx + 1])
    ) {
      flushList();
      const header = parseRow(trimmed);
      const rows = [];
      let j = idx + 2;
      while (j < lines.length && isTableRow(lines[j]) && lines[j].trim()) {
        rows.push(parseRow(lines[j]));
        j += 1;
      }
      blocks.push(
        <div key={`tbl-${idx}`} style={{ overflowX: 'auto', margin: '6px 0 10px' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
            <thead>
              <tr>
                {header.map((cell, c) => (
                  <th
                    key={c}
                    style={{
                      textAlign: 'left',
                      padding: '5px 8px',
                      color: '#fff',
                      fontWeight: 600,
                      borderBottom: '1px solid rgba(255,255,255,0.25)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {renderInline(cell, `th-${idx}-${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {header.map((_, c) => (
                    <td
                      key={c}
                      style={{
                        padding: '5px 8px',
                        verticalAlign: 'top',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      {renderInline(row[c] ?? '', `td-${idx}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      idx = j - 1;
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushList();
      blocks.push(
        <hr
          key={`hr-${idx}`}
          style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', margin: '10px 0' }}
        />
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const size = level === 1 ? 15 : level === 2 ? 13 : 12;
      blocks.push(
        <div
          key={`h-${idx}`}
          style={{ fontSize: `${size}px`, fontWeight: 700, color: '#fff', margin: '10px 0 4px' }}
        >
          {renderInline(heading[2], `h-${idx}`)}
        </div>
      );
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${idx}`} style={{ margin: '0 0 8px' }}>
        {renderInline(trimmed, `p-${idx}`)}
      </p>
    );
  }

  flushList();

  return <div>{blocks}</div>;
};

export default MarkdownLite;
