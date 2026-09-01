/**
 * Pure functions over a tag-derived VirtualNode tree. No `obsidian` import,
 * no I/O — everything here takes its inputs as arguments and returns new
 * data, so it's testable with a fake VaultIndex.
 */
import type { VaultIndex } from "./vault-index";
import type { VirtualNode } from "./view";

function labelFor(node: VirtualNode): string {
  return node.kind === "group" ? node.label : node.path.split("/").pop() || node.path;
}

/**
 * Sort a tree the way core File Explorer sorts a folder: groups before
 * files, alphabetical within each, applied recursively. There is no manual
 * ordering in this plugin — like Obsidian's own explorer, dragging only
 * ever resolves *which container* a reference belongs to, never a position
 * within it, so storage order is irrelevant and this is the single place
 * display order is decided.
 */
export function sortTree(nodes: VirtualNode[]): VirtualNode[] {
  return [...nodes]
    .sort((a, b) => {
      const aIsContainer = a.kind === "group";
      const bIsContainer = b.kind === "group";
      if (aIsContainer !== bIsContainer) return aIsContainer ? -1 : 1;
      return labelFor(a).localeCompare(labelFor(b));
    })
    .map((n) => (n.kind === "file" ? n : { ...n, children: sortTree(n.children) }));
}

/**
 * Build the tree for a tag view rooted at `rootTag`: every file tagged with
 * `rootTag` itself or any tag nested under it (`rootTag/...`) is included,
 * with the tag's remaining segments below the root turned into nested
 * group nodes. A file with two matching tags appears twice, once per tag —
 * there's no dedup, since each occurrence is a distinct, independently
 * editable position in the tree (dragging one out only removes that one
 * tag).
 */
export function resolveTagRootView(rootTag: string, index: VaultIndex): VirtualNode[] {
  interface Branch {
    children: Map<string, Branch>;
    files: VirtualNode[];
  }
  const root: Branch = { children: new Map(), files: [] };

  for (const file of index.listFiles()) {
    for (const tag of file.tags) {
      let rest: string[];
      if (tag === rootTag) rest = [];
      else if (tag.startsWith(`${rootTag}/`)) rest = tag.slice(rootTag.length + 1).split("/");
      else continue;

      let branch = root;
      for (const segment of rest) {
        let next = branch.children.get(segment);
        if (!next) {
          next = { children: new Map(), files: [] };
          branch.children.set(segment, next);
        }
        branch = next;
      }
      branch.files.push({ kind: "file", id: `file:${file.path}#${tag}`, path: file.path, sourceTag: tag });
    }
  }

  const toNodes = (branch: Branch, tagPath: string): VirtualNode[] => {
    const groups: VirtualNode[] = [...branch.children.entries()].map(([label, child]) => {
      const childTagPath = `${tagPath}/${label}`;
      return {
        kind: "group" as const,
        id: `group:${childTagPath}`,
        label,
        tagPath: childTagPath,
        children: toNodes(child, childTagPath),
      };
    });
    return [...groups, ...branch.files];
  };

  return sortTree(toNodes(root, rootTag));
}

/** True if a group with this exact tagPath appears anywhere in the tree. */
export function hasTagPath(nodes: VirtualNode[], tagPath: string): boolean {
  return nodes.some(
    (n) => n.kind === "group" && (n.tagPath === tagPath || hasTagPath(n.children, tagPath)),
  );
}

/**
 * Insert an ephemeral placeholder branch (from "+ New group" — not backed by
 * any file yet) under the group with tagPath `parentTagPath`, or at the
 * root when `parentTagPath` equals the view's own root tag. No-ops if a
 * branch with the placeholder's tagPath already exists for real (e.g. a
 * file was just dragged into it, making the placeholder redundant). This is
 * session-only scaffolding — never persisted, re-derived by the caller each
 * render; see ui/view-pane.ts.
 */
export function insertPendingGroup(
  nodes: VirtualNode[],
  rootTag: string,
  parentTagPath: string,
  group: Extract<VirtualNode, { kind: "group" }>,
): VirtualNode[] {
  if (hasTagPath(nodes, group.tagPath)) return nodes;
  if (parentTagPath === rootTag) return sortTree([...nodes, group]);
  return sortTree(
    nodes.map((n) => {
      if (n.kind === "file") return n;
      if (n.tagPath === parentTagPath) return { ...n, children: [...n.children, group] };
      return { ...n, children: insertPendingGroup(n.children, rootTag, parentTagPath, group) };
    }),
  );
}

/** Default label for a freshly created placeholder branch, matching core
 * Explorer's "New folder" naming: "Untitled", then "Untitled 1", "Untitled
 * 2", ... against whatever labels are already taken among the given
 * siblings. */
export function nextUntitledLabel(siblingLabels: string[]): string {
  if (!siblingLabels.includes("Untitled")) return "Untitled";
  let i = 1;
  while (siblingLabels.includes(`Untitled ${i}`)) i++;
  return `Untitled ${i}`;
}

/** Maps a single tag through a prefix rename/move: an exact match on
 * `oldPrefix`, or any tag nested under it, is rewritten onto `newPrefix`;
 * anything else is returned unchanged. Used both to decide which files a
 * branch rename/drag-move touches and to compute each one's new tag. */
export function remapTagPrefix(tag: string, oldPrefix: string, newPrefix: string): string {
  if (tag === oldPrefix) return newPrefix;
  if (tag.startsWith(`${oldPrefix}/`)) return newPrefix + tag.slice(oldPrefix.length);
  return tag;
}
