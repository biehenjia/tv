/**
 * Domain types for a tag view: a live tree rendered directly from the
 * vault's frontmatter tags, rooted at one tag the user picked. Nothing in
 * this file may import from `obsidian` — see
 * .docs/plugin-dev/file-explorer-views.md in the vault for the rule.
 *
 * There is no separate "view definition" to persist: a tag view has no
 * content of its own, only a root tag (kept in the pane's leaf state, not a
 * vault file — see ui/view-pane.ts). The tree itself is always recomputed
 * from the vault's current tags, so it can never go stale and there's
 * nothing to migrate when tags change elsewhere. Editing the tree (dragging
 * a file into a branch, renaming a branch) edits the underlying files'
 * frontmatter tags directly — see adapters/obsidian-tag-writer.ts.
 */

export type FilePath = string;

export type VirtualNode =
  | {
      kind: "file";
      id: string;
      path: FilePath;
      /** the exact frontmatter tag on this file that placed it here — an
       * occurrence, not a general reference: a file with two matching tags
       * appears as two distinct nodes, one per tag. Needed so a drag/remove
       * on this specific row can compute exactly which tag to mutate. */
      sourceTag: string;
    }
  | {
      kind: "group";
      id: string;
      /** the last tag-path segment, e.g. "frontend" for tagPath
       * "project/frontend" */
      label: string;
      /** the full tag this branch represents, e.g. "project/frontend" —
       * used to compute the tag for a file dropped directly on this group,
       * and as the prefix for a bulk rename when this group is renamed. */
      tagPath: string;
      children: VirtualNode[];
    };

/** Where to open a tag-view pane — "main" is the primary editor area (a
 * vertical split), "left"/"right" are the sidebars, where this view is
 * meant to live day-to-day (see ui/view-pane.ts). */
export type ViewPlacement = "main" | "left" | "right";
