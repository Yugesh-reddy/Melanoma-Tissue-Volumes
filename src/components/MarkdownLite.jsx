import React from 'react';

// Minimal markdown renderer for the streaming AI narrative.
// Supports: # / ## / ### headings, **bold**, bullet lists (-, *), numbered
// lists, and paragraphs. Intentionally tiny — no external dependency, which
// keeps the GitHub-Pages build and the Google-Drive dev mount friction-free.

const renderInline = (text, keyPrefix) => {
  // Split on **bold** spans, keeping the delimiters' content.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-b-${i}`} style={{ color: '#fff', fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={`${keyPrefix}-t-${i}`}>{part}</React.Fragment>;
  });
};

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

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      return;
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
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      return;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      return;
    }

    flushList();
    blocks.push(
      <p key={`p-${idx}`} style={{ margin: '0 0 8px' }}>
        {renderInline(trimmed, `p-${idx}`)}
      </p>
    );
  });

  flushList();

  return <div>{blocks}</div>;
};

export default MarkdownLite;
