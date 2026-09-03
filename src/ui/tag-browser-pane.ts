/**
 * A from-scratch, read-only browser over every tag in the vault — stands in
 * for core's own Tags pane, but clicking a tag opens/updates our tag view
 * (see ui/view-pane.ts) instead of core's global search. This is a
 * deliberate alternative to intercepting core's Tags pane: that would mean
 * capture-phase click hijacking plus reconstructing tag paths from
 * undocumented, compressed DOM (core collapses single-child intermediate
 * levels) — fragile reverse-engineering of a UI surface we don't own.
 * Owning our own tree here needs nothing but the public VaultIndex read
 * model, at the cost of one simplification: unlike core, this doesn't
 * compress a chain of single-child tag segments into one row — every
 * segment gets its own row, even if it's the only child.
 *
 * DOM structure and class names (tag-container / tree-item / tag-pane-tag /
 * tag-pane-tag-count / ...) intentionally mirror core's own Tags pane
 * markup, so the active theme styles this identically without any custom
 * CSS — same trick view-pane.ts uses against core File Explorer. Fold
 * (collapse-all/expand-all) and sort (the same four orders core's Tags
 * pane offers — alphabetical/frequency, each ascending/descending) mimic
 * core's own header actions the same way.
 */
import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { VaultIndex } from "../core/vault-index";
import { buildTagTree, sortTagTree, type TagSortOrder, type TagTreeNode } from "../core/tag-tree";

export const TAG_BROWSER_VIEW_TYPE = "tag-browser-pane";

export interface TagBrowserPaneDeps {
  index: VaultIndex;
  /** Reveal/create the tag view pane rooted at this tag — main.ts's
   * composition-root logic, shared with the header search bar's own
   * root-tag switching. */
  onOpenTag: (tag: string) => void;
}

const SORT_ORDERS: { order: TagSortOrder; label: string }[] = [
  { order: "alphabetical", label: "Name (A to Z)" },
  { order: "alphabeticalReverse", label: "Name (Z to A)" },
  { order: "frequency", label: "Frequency (high to low)" },
  { order: "frequencyReverse", label: "Frequency (low to high)" },
];

export class TagBrowserPane extends ItemView {
  private collapsed = new Set<string>();
  private sortOrder: TagSortOrder = "alphabetical";
  private unsubscribeIndex: (() => void) | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private deps: TagBrowserPaneDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return TAG_BROWSER_VIEW_TYPE;
  }

  getIcon(): string {
    return "tags";
  }

  getDisplayText(): string {
    return "Tags";
  }

  async onOpen() {
    this.contentEl.addClass("tag-browser-pane-content");
    this.unsubscribeIndex = this.deps.index.onChange(() => this.render());
    this.render();
  }

  onClose(): Promise<void> {
    this.unsubscribeIndex?.();
    return super.onClose();
  }

  private createToolbarIconButton(parentEl: HTMLElement, icon: string, label: string): HTMLElement {
    const button = parentEl.createDiv({ cls: "clickable-icon tree-view-toolbar-icon" });
    button.setAttr("aria-label", label);
    setIcon(button, icon);
    return button;
  }

  private cycleSortOrder() {
    const i = SORT_ORDERS.findIndex((s) => s.order === this.sortOrder);
    this.sortOrder = SORT_ORDERS[(i + 1) % SORT_ORDERS.length].order;
    this.render();
  }

  /** Toggles between "everything collapsed" and "everything expanded" —
   * same fold behavior as core's own Tags pane header button. */
  private toggleCollapseAll(tree: TagTreeNode[]) {
    if (this.collapsed.size === 0) {
      const all = new Set<string>();
      const collect = (nodes: TagTreeNode[]) => {
        for (const n of nodes) {
          if (n.children.length > 0) {
            all.add(n.tag);
            collect(n.children);
          }
        }
      };
      collect(tree);
      this.collapsed = all;
    } else {
      this.collapsed = new Set();
    }
    this.render();
  }

  private render() {
    const container = this.contentEl;
    container.empty();

    const tree = sortTagTree(buildTagTree(this.deps.index), this.sortOrder);

    const header = container.createDiv({ cls: "nav-header tree-view-toolbar" });
    const toolbar = header.createDiv({ cls: "nav-buttons-container" });
    const collapseButton = this.createToolbarIconButton(toolbar, "chevrons-down-up", "Collapse all");
    collapseButton.addEventListener("click", () => this.toggleCollapseAll(tree));
    const sortLabel = SORT_ORDERS.find((s) => s.order === this.sortOrder)?.label ?? "";
    const sortButton = this.createToolbarIconButton(toolbar, "arrow-up-narrow-wide", `Change sort order (${sortLabel})`);
    sortButton.addEventListener("click", () => this.cycleSortOrder());

    const tagContainer = container.createDiv({ cls: "tag-container" });
    if (tree.length === 0) {
      tagContainer.createDiv({ cls: "pane-empty", text: "No tags yet." });
      return;
    }
    this.renderNodes(tagContainer, tree);
  }

  private renderNodes(parentEl: HTMLElement, nodes: TagTreeNode[]) {
    for (const node of nodes) this.renderNode(parentEl, node);
  }

  private renderNode(parentEl: HTMLElement, node: TagTreeNode) {
    const hasChildren = node.children.length > 0;
    const isCollapsed = this.collapsed.has(node.tag);

    const item = parentEl.createDiv({ cls: "tree-item" });
    if (isCollapsed) item.addClass("is-collapsed");
    const title = item.createDiv({
      cls: `tree-item-self is-clickable tag-pane-tag${hasChildren ? " mod-collapsible" : ""}`,
    });

    if (hasChildren) {
      const collapseIcon = title.createDiv({ cls: "tree-item-icon collapse-icon" });
      if (isCollapsed) collapseIcon.addClass("is-collapsed");
      setIcon(collapseIcon, "right-triangle");
      collapseIcon.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (this.collapsed.has(node.tag)) this.collapsed.delete(node.tag);
        else this.collapsed.add(node.tag);
        this.render();
      });
    }

    title.createDiv({ cls: "tree-item-inner-text", text: node.label });
    if (node.count > 0) {
      const flair = title.createDiv({ cls: "tree-item-flair-outer" });
      flair.createSpan({ cls: "tag-pane-tag-count tree-item-flair", text: String(node.count) });
    }

    title.addEventListener("click", () => this.deps.onOpenTag(node.tag));

    if (hasChildren && !isCollapsed) {
      const childrenEl = item.createDiv({ cls: "tree-item-children" });
      this.renderNodes(childrenEl, node.children);
    }
  }
}
