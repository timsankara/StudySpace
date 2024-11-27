// Text formatting utilities for StudySpace
const MARKDOWN_RULES = {
  // Headers with proper spacing and styling
  headers: [
    {
      pattern: /^# (.*$)/gm,
      replacement: '<h1 class="summary-heading">$1</h1>',
    },
    {
      pattern: /^## (.*$)/gm,
      replacement: '<h2 class="section-heading">$1</h2>',
    },
    {
      pattern: /^### (.*$)/gm,
      replacement: '<h3 class="subsection-heading">$1</h3>',
    },
  ],

  // Lists with proper nesting and spacing
  lists: {
    pattern: /^[-*]\s(.+)$/gm,
    wrapPattern: /(?:^[-*]\s(.+)$\n?)+/gm,
    itemReplacement: '<li class="summary-item">$1</li>',
    wrapReplacement: '<ul class="summary-list">$&</ul>',
  },

  // Emphasis and strong text
  emphasis: [
    {
      pattern: /\*\*([^*]+)\*\*/g,
      replacement: '<strong class="emphasis-strong">$1</strong>',
    },
    {
      pattern: /\*([^*]+)\*/g,
      replacement: '<em class="emphasis-italic">$1</em>',
    },
  ],

  // Paragraphs with proper spacing
  paragraphs: {
    pattern: /\n\n/g,
    replacement: '</p><p class="summary-paragraph">',
  },
};

export function formatSummaryText(text) {
  if (!text) return "";

  let formatted = text.trim();

  // Apply header formatting
  MARKDOWN_RULES.headers.forEach((rule) => {
    formatted = formatted.replace(rule.pattern, rule.replacement);
  });

  // Handle list items and wrapping
  formatted = formatted.replace(
    MARKDOWN_RULES.lists.pattern,
    MARKDOWN_RULES.lists.itemReplacement,
  );
  formatted = formatted.replace(MARKDOWN_RULES.lists.wrapPattern, (match) => {
    return `<ul class="summary-list">${match}</ul>`;
  });

  // Apply emphasis formatting
  MARKDOWN_RULES.emphasis.forEach((rule) => {
    formatted = formatted.replace(rule.pattern, rule.replacement);
  });

  // Handle paragraphs
  formatted = `<p class="summary-paragraph">${formatted}</p>`;
  formatted = formatted.replace(
    MARKDOWN_RULES.paragraphs.pattern,
    '</p><p class="summary-paragraph">',
  );

  // Clean up any empty or malformed elements
  formatted = formatted
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/<p>\s*<ul>/g, "<ul>")
    .replace(/<\/ul>\s*<\/p>/g, "</ul>")
    .replace(/(<li>)\s*|\s*(<\/li>)/g, "$1$2");

  return sanitizeHTML(formatted);
}

function sanitizeHTML(html) {
  const ALLOWED_TAGS = {
    h1: ["class"],
    h2: ["class"],
    h3: ["class"],
    p: ["class"],
    ul: ["class"],
    li: ["class"],
    strong: ["class"],
    em: ["class"],
  };

  const div = document.createElement("div");
  div.innerHTML = html;

  function sanitizeNode(node) {
    if (node.nodeType === 3) return; // Text node

    const tagName = node.tagName.toLowerCase();
    if (!ALLOWED_TAGS[tagName]) {
      node.parentNode.removeChild(node);
      return;
    }

    // Remove all attributes except allowed ones
    const attrs = Array.from(node.attributes);
    attrs.forEach((attr) => {
      if (!ALLOWED_TAGS[tagName].includes(attr.name)) {
        node.removeAttribute(attr.name);
      }
    });

    // Recursively sanitize children
    Array.from(node.children).forEach(sanitizeNode);
  }

  Array.from(div.children).forEach(sanitizeNode);
  return div.innerHTML;
}
