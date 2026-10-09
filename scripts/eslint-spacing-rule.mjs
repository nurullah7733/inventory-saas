// Scope this rule to UI TSX files. Dimensions and zero/auto layout resets remain valid.
const numericSpacing = /(?<![\w])(-?(?:space-[xy]|gap(?:-[xy])?|[pm][trblxy]?)-)(\d+(?:\.\d+)?)(?![\w.-])/g;
const spacingRule = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: { numeric: 'Use a named theme spacing token instead of "{{utility}}". See docs/ui-spacing.md.' },
  },
  create(context) {
    function check(node, text) {
      if (typeof text !== "string") return;
      for (const match of text.matchAll(numericSpacing)) {
        if (Number(match[2]) !== 0) context.report({ node, messageId: "numeric", data: { utility: match[0] } });
      }
      for (const match of text.matchAll(/(?:^|[\s:])(-?(?:space-[xy]|gap(?:-[xy])?|[pm][trblxy]?)-\[[^\]]+\])/g)) {
        if (!match[1].includes("var(--space-")) context.report({ node, messageId: "numeric", data: { utility: match[1] } });
      }
    }
    return {
      Literal(node) { check(node, node.value); },
      TemplateElement(node) { check(node, node.value.cooked); },
    };
  },
};
export default spacingRule;
