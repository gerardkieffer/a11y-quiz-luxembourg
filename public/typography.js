// French typographic spacing: replaces the regular space after « and before
// », ? and ! with a non-breaking space, so punctuation never gets stranded
// alone at the start of a line.
const NBSP = "\u00A0"; // non-breaking space

export function fixFrenchSpacing(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    const tag = node.parentElement?.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") continue;
    textNodes.push(node);
  }
  for (const textNode of textNodes) {
    textNode.textContent = textNode.textContent
      .replace(/«[ \t]/g, `«${NBSP}`)
      .replace(/[ \t]([»?!])/g, `${NBSP}$1`);
  }
}

fixFrenchSpacing(document.body);
