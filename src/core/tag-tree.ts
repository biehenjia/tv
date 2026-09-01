/**
 * The full vault-wide tag hierarchy — every distinct frontmatter tag,
 * nested by its `/` segments, with a per-tag file count. Backs
 * ui/tag-browser-pane.ts, a from-scratch read-only browser standing in for
 * core's own Tags pane (see that file's header for why: intercepting core's
 * Tags pane click behavior would mean reverse-engineering undocumented DOM/
 * internals, whereas owning our own tree here needs nothing but the public
 * VaultIndex read model).
 */
import type { VaultIndex } from "./vault-index";

export interface TagTreeNode {
  /** full path from the vault root, e.g. "project/frontend" */
  tag: string;
  /** this node's own segment, e.g. "frontend" */
  label: string;
  /** files tagged with exactly this tag (not counting descendants) */
  count: number;
  children: TagTreeNode[];
}

export function buildTagTree(index: VaultIndex): TagTreeNode[] {
  interface Branch {
    children: Map<string, Branch>;
    count: number;
  }
  const root: Branch = { children: new Map(), count: 0 };

  for (const file of index.listFiles()) {
    for (const tag of file.tags) {
      let branch = root;
      for (const segment of tag.split("/")) {
        let next = branch.children.get(segment);
        if (!next) {
          next = { children: new Map(), count: 0 };
          branch.children.set(segment, next);
        }
        branch = next;
      }
      branch.count++;
    }
  }

  const toNodes = (branch: Branch, prefix: string): TagTreeNode[] =>
    [...branch.children.entries()].map(([label, child]) => {
      const tag = prefix ? `${prefix}/${label}` : label;
      return { tag, label, count: child.count, children: toNodes(child, tag) };
    });

  return toNodes(root, "");
}

/** Matches core's own Tags pane sort orders (same four, same names) — kept
 * as a separate pass over the built tree rather than baked into
 * buildTagTree, so re-sorting doesn't require re-walking the vault. */
export type TagSortOrder = "alphabetical" | "alphabeticalReverse" | "frequency" | "frequencyReverse";

export function sortTagTree(nodes: TagTreeNode[], order: TagSortOrder): TagTreeNode[] {
  const compare = (a: TagTreeNode, b: TagTreeNode): number => {
    switch (order) {
      case "alphabetical":
        return a.label.localeCompare(b.label);
      case "alphabeticalReverse":
        return b.label.localeCompare(a.label);
      case "frequency":
        return b.count - a.count || a.label.localeCompare(b.label);
      case "frequencyReverse":
        return a.count - b.count || a.label.localeCompare(b.label);
    }
  };
  return [...nodes].sort(compare).map((n) => ({ ...n, children: sortTagTree(n.children, order) }));
}
