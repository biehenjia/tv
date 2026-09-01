/**
 * Renders a tag view: a live tree computed from the vault's frontmatter
 * tags, rooted at one tag the user picked (see core/operations.ts's
 * resolveTagRootView). Owns DOM/drag-drop only — tree-shape logic is
 * core/operations, and every mutation (drag in/out/between branches,
 * renaming a branch) is delegated to adapters/obsidian-tag-writer, the one
 * place this plugin writes to real files.
 *
 * Unlike the old `.tv`-file views, a tag view has no content of its own to
 * persist — only its root tag, which lives in leaf state (getState/
 * setState), the same mechanism Obsidian already uses to remember e.g.
 * which file a normal editor tab had open. No vault file, no plugin
 * data.json entry: closing/reopening Obsidian restores it for free via
 * workspace.json, same as any other pane.
 *
 * DOM structure and class names (tree-item / nav-folder / nav-file / ...)
 * intentionally mirror Obsidian's own core File Explorer markup, so the
 * active theme styles this pane identically without any custom CSS.
 *
 * Drag-and-drop rides Obsidian's own `dragManager` (adapters/obsidian-drag)
 * — see that file's header for why, and view-pane's git history for the
 * findRowAtY Y-band row-targeting approach.
 */
import { Menu, TFile, ItemView, SearchComponent, WorkspaceLeaf, setIcon, type ViewStateResult } from "obsidian";
import type { VaultIndex } from "../core/vault-index";
import type { VirtualNode } from "../core/view";
import { insertPendingGroup, nextUntitledLabel, resolveTagRootView } from "../core/operations";
import { ObsidianTagWriter } from "../adapters/obsidian-tag-writer";
import {
  filesFromDraggable,
  registerDropTarget,
  startObsidianDrag,
  type DropResult,
  type ObsidianDraggable,
} from "../adapters/obsidian-drag";
import { FileSuggestModal } from "./file-suggest-modal";
import { TagRootInputSuggest } from "./tag-root-suggest";

export const TREE_VIEW_TYPE = "tree-view-pane";

export interface ViewPaneDeps {
  index: VaultIndex;
  tagWriter: ObsidianTagWriter;
}

type GroupNode = Extract<VirtualNode, { kind: "group" }>;

function basename(path: string): string {
  return path.split("/").pop() || path;
}

const INTERNAL_DRAG_TYPE = "text/tree-view-node-id";

export class TreeViewPane extends ItemView {
  private rootTag: string | undefined;
  private collapsed = new Set<string>();
  private selected = new Set<string>();
  private selectionAnchorId: string | undefined;
  /** Placeholder branches from "+ New group" that no file has been tagged
   * into yet — ephemeral, never persisted, dropped once a real tag matches
   * or the pane's root tag changes. */
  private pendingGroups: { parentTagPath: string; group: GroupNode }[] = [];
  /** Visual (depth-first) order of currently-rendered node ids, rebuilt every
   * render; used to resolve shift-click range selection. */
  private renderOrder: string[] = [];
  private nodesById = new Map<string, VirtualNode>();
  /** Each node's enclosing tag path (its parent group's tagPath, or the
   * root tag for top-level nodes), rebuilt every render. */
  private scopeById = new Map<string, string>();
  /** tagPaths that came from resolveTagRootView (i.e. at least one real
   * file has that tag) — distinguishes a real branch (rename = bulk tag
   * mutation) from a still-empty pending one (rename = local state only). */
  private realTagPaths = new Set<string>();
  private dropHoverEl: HTMLElement | null = null;
  private editingNodeId: string | null = null;
  /** Built once in onOpen, not recreated on every renderTree() — a text
   * input mid-typing can't survive being torn down and rebuilt, which
   * would otherwise happen on every vault change (see onOpen's
   * VaultIndex.onChange subscription). */
  private searchComponent: SearchComponent | undefined;
  private filesContainerEl: HTMLElement | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private deps: ViewPaneDeps,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return TREE_VIEW_TYPE;
  }

  getIcon(): string {
    return "tags";
  }

  getDisplayText(): string {
    return this.rootTag ? `#${this.rootTag}` : "Tag view";
  }

  getState(): Record<string, unknown> {
    return { rootTag: this.rootTag };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = state as { rootTag?: string } | undefined;
    this.rootTag = s?.rootTag;
    this.pendingGroups = [];
    await super.setState(state, result);
    this.updateSearchValue();
    this.renderTree();
  }

  /** Set (or change) the root tag from outside — main.ts's open command
   * (for a freshly created pane) and the search bar's own suggestion
   * selection. */
  setRootTag(tag: string) {
    this.rootTag = tag;
    this.pendingGroups = [];
    this.app.workspace.requestSaveLayout();
    this.updateSearchValue();
    this.renderTree();
  }

  /** Focuses the header search bar — main.ts calls this right after
   * creating a fresh pane, and the header menu's "Change root tag" reuses
   * it instead of duplicating the picker as a separate modal. */
  focusSearch() {
    this.searchComponent?.inputEl.focus();
    this.searchComponent?.inputEl.select();
  }

  private updateSearchValue() {
    this.searchComponent?.setValue(this.rootTag ?? "");
  }

  /** Unsubscribes from VaultIndex.onChange — set in onOpen, called in
   * onClose. */
  private unsubscribeIndex: (() => void) | undefined;

  async onOpen() {
    const container = this.contentEl;
    container.tabIndex = -1;
    container.addClass("tree-view-pane-content");
    container.addEventListener("keydown", (ev) => {
      if ((ev.key === "Delete" || ev.key === "Backspace") && this.selected.size > 0) {
        ev.preventDefault();
        this.removeFromView([...this.selected]);
      }
    });
    container.addEventListener("dragleave", (ev) => {
      if (!container.contains(ev.relatedTarget as Node)) this.setDropHover(null);
    });
    registerDropTarget(this.app, container, (ev, draggable, isDragOver) =>
      this.handleDelegatedDrop(ev, draggable, isDragOver),
    );
    this.addAction("ellipsis-vertical", "View options", (ev) => this.openViewMenu(ev));

    // Header is built once and never torn down by renderTree() — the
    // search input needs to survive re-renders while the user is mid-typing
    // (see the searchComponent field's doc comment).
    const header = container.createEl("div", { cls: "nav-header tree-view-toolbar" });
    const searchRow = header.createEl("div", { cls: "tree-view-search-row" });
    this.searchComponent = new SearchComponent(searchRow);
    this.searchComponent.setPlaceholder("Switch tag root...");
    new TagRootInputSuggest(
      this.app,
      this.searchComponent.inputEl,
      () => this.deps.index.listTags(),
      (tag) => this.setRootTag(tag),
    );
    this.updateSearchValue();

    const toolbar = header.createEl("div", { cls: "nav-buttons-container" });
    const addButton = this.createToolbarIconButton(toolbar, "folder-input", "Add file");
    addButton.addEventListener("click", () => this.openAddPicker());
    const groupButton = this.createToolbarIconButton(toolbar, "folder-plus", "New group");
    groupButton.addEventListener("click", () => this.createGroup());

    this.filesContainerEl = container.createEl("div", { cls: "nav-files-container" });

    // The tree is always a live read of the vault's current tags — rather
    // than each mutation guessing when it's safe to re-render, one
    // subscription re-renders on every real vault/metadata change,
    // including ones this pane itself just made (see
    // ObsidianVaultIndex.onChange's doc comment on why it's metadataCache's
    // "changed" event specifically, not vault's "modify").
    this.unsubscribeIndex = this.deps.index.onChange(() => this.renderTree());
    this.renderTree();
  }

  onClose(): Promise<void> {
    this.unsubscribeIndex?.();
    return super.onClose();
  }

  private openViewMenu(ev: MouseEvent) {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Change root tag").setIcon("tags").onClick(() => this.focusSearch()));
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Move to left sidebar")
        .setIcon("panel-left")
        .onClick(() => void this.moveTo("left")),
    );
    menu.addItem((item) =>
      item
        .setTitle("Move to right sidebar")
        .setIcon("panel-right")
        .onClick(() => void this.moveTo("right")),
    );
    menu.addItem((item) =>
      item
        .setTitle("Move to main area")
        .setIcon("layout-panel-left")
        .onClick(() => void this.moveTo("main")),
    );
    menu.showAtMouseEvent(ev);
  }

  /** Reopens this same pane's state in a leaf in the given location and
   * closes the current one — there's no "move a leaf" primitive in the
   * public API, so relocating is detach-and-reopen. Opens the new leaf
   * *before* detaching this one: detach tears this view instance down, so
   * anything using `this` has to happen first. */
  private async moveTo(placement: "left" | "right" | "main") {
    const workspace = this.app.workspace;
    const state = this.getState();
    const originLeaf = this.leaf;
    const target =
      placement === "left"
        ? (workspace.getLeftLeaf(false) ?? workspace.getLeaf("tab"))
        : placement === "right"
          ? (workspace.getRightLeaf(false) ?? workspace.getLeaf("tab"))
          : workspace.getLeaf("split", "vertical");
    await target.setViewState({ type: TREE_VIEW_TYPE, active: true, state });
    originLeaf.detach();
    workspace.revealLeaf(target);
  }

  /** Which tagPath "+ Add file"/"+ New group" should target: the single
   * selected group's tagPath, or the view's own root otherwise. */
  private currentScope(): string | undefined {
    if (this.selected.size === 1) {
      const node = this.nodesById.get([...this.selected][0]);
      if (node?.kind === "group") return node.tagPath;
    }
    return this.rootTag;
  }

  private childLabelsAt(tagPath: string): string[] {
    const parent = [...this.nodesById.values()].find((n) => n.kind === "group" && n.tagPath === tagPath) as
      | GroupNode
      | undefined;
    const children = parent ? parent.children : this.lastRootNodes;
    return children.filter((n): n is GroupNode => n.kind === "group").map((n) => n.label);
  }

  private lastRootNodes: VirtualNode[] = [];

  private openAddPicker() {
    if (!this.rootTag) return;
    const scope = this.currentScope();
    if (!scope) return;
    new FileSuggestModal(this.app, (file) => {
      if (!(file instanceof TFile)) return;
      void this.deps.tagWriter.addTag(file.path, scope);
    }).open();
  }

  private createGroup() {
    if (!this.rootTag) return;
    const scope = this.currentScope();
    if (!scope) return;
    const label = nextUntitledLabel(this.childLabelsAt(scope));
    const tagPath = `${scope}/${label}`;
    const group: GroupNode = { kind: "group", id: `group:${tagPath}`, label, tagPath, children: [] };
    this.pendingGroups = [...this.pendingGroups, { parentTagPath: scope, group }];
    this.editingNodeId = group.id;
    this.renderTree();
  }

  /** Remove tag-view nodes: a file node loses just its sourceTag; a real
   * group's whole tag prefix (and every descendant tag under it) is
   * stripped from every file that has it; a still-empty pending group is
   * just discarded locally. Applied immediately, same as a branch rename —
   * see adapters/obsidian-tag-writer.ts. */
  private removeFromView(nodeIds: string[]) {
    if (nodeIds.length === 0) return;
    for (const id of nodeIds) {
      const node = this.nodesById.get(id);
      if (!node) continue;
      if (node.kind === "file") {
        void this.deps.tagWriter.removeTag(node.path, node.sourceTag);
      } else if (this.realTagPaths.has(node.tagPath)) {
        void this.deps.tagWriter.removeTagPrefix(node.tagPath);
      } else {
        this.pendingGroups = this.pendingGroups.filter((p) => p.group.tagPath !== node.tagPath);
      }
      this.selected.delete(id);
    }
    // Only the pending-group branch above needs this: real tag mutations
    // re-render via the VaultIndex subscription once metadataCache actually
    // reflects them (see onOpen) — rendering here too would just show the
    // stale pre-mutation state a moment early.
    this.renderTree();
  }

  private selectRange(fromId: string, toId: string) {
    const i1 = this.renderOrder.indexOf(fromId);
    const i2 = this.renderOrder.indexOf(toId);
    if (i1 === -1 || i2 === -1) {
      this.selected = new Set([toId]);
      return;
    }
    const [lo, hi] = i1 < i2 ? [i1, i2] : [i2, i1];
    this.selected = new Set(this.renderOrder.slice(lo, hi + 1));
  }

  private handleItemClick(ev: MouseEvent, node: VirtualNode) {
    if (ev.shiftKey && this.selectionAnchorId) {
      this.selectRange(this.selectionAnchorId, node.id);
    } else if (ev.metaKey || ev.ctrlKey) {
      if (this.selected.has(node.id)) this.selected.delete(node.id);
      else this.selected.add(node.id);
      this.selectionAnchorId = node.id;
    } else if (node.kind === "file") {
      this.selected = new Set();
      this.selectionAnchorId = node.id;
      void this.app.workspace.openLinkText(node.path, "", false);
    } else {
      this.selected = new Set([node.id]);
      this.selectionAnchorId = node.id;
      if (this.collapsed.has(node.id)) this.collapsed.delete(node.id);
      else this.collapsed.add(node.id);
    }
    this.contentEl.focus();
    this.renderTree();
  }

  private openContextMenu(ev: MouseEvent, node: VirtualNode) {
    const isMultiSelection = this.selected.size > 1 && this.selected.has(node.id);

    const menu = new Menu();
    if (node.kind === "file" && !isMultiSelection) {
      menu.addItem((item) =>
        item
          .setTitle("Open in new tab")
          .setIcon("file-plus")
          .onClick(() => void this.app.workspace.openLinkText(node.path, "", true)),
      );
    }
    if (node.kind === "group" && !isMultiSelection) {
      menu.addItem((item) =>
        item
          .setTitle("Rename")
          .setIcon("pencil")
          .onClick(() => {
            this.editingNodeId = node.id;
            this.renderTree();
          }),
      );
    }
    menu.addItem((item) =>
      item
        .setTitle("Remove from view")
        .setIcon("x")
        .onClick(() => this.removeFromView([node.id])),
    );
    if (isMultiSelection && this.selected.size > 1) {
      menu.addItem((item) =>
        item
          .setTitle(`Remove ${this.selected.size} items from view`)
          .setIcon("x")
          .onClick(() => this.removeFromView([...this.selected])),
      );
    }
    menu.showAtMouseEvent(ev);
  }

  private createToolbarIconButton(parentEl: HTMLElement, icon: string, label: string): HTMLElement {
    const button = parentEl.createEl("div", { cls: "clickable-icon tree-view-toolbar-icon" });
    button.setAttr("aria-label", label);
    setIcon(button, icon);
    return button;
  }

  /** Puts a group row into rename mode the same way core Explorer does: the
   * existing label made `contenteditable`, `is-being-renamed` on the row —
   * see the class's original .tv-era doc comment (git history) for why this
   * needs no custom CSS. Enter/blur commit; Escape cancels. */
  private renderInlineRename(titleEl: HTMLElement, currentLabel: string, node: GroupNode, parentScope: string) {
    titleEl.addClass("is-being-renamed");
    const label = titleEl.createEl("div", {
      cls: "tree-item-inner nav-folder-title-content",
      text: currentLabel,
    });
    label.setAttr("contenteditable", "true");
    label.setAttr("spellcheck", "false");
    label.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        label.blur();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        this.editingNodeId = null;
        this.renderTree();
      }
    });
    label.addEventListener("blur", () => this.commitInlineRename(node, label.textContent ?? "", parentScope));
    requestAnimationFrame(() => {
      label.focus();
      const range = document.createRange();
      range.selectNodeContents(label);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }

  private commitInlineRename(node: GroupNode, value: string, parentScope: string) {
    if (this.editingNodeId !== node.id) return;
    this.editingNodeId = null;
    const label = value.trim() || node.label;
    if (label === node.label) {
      this.renderTree();
      return;
    }
    const newTagPath = `${parentScope}/${label}`;
    if (this.realTagPaths.has(node.tagPath)) {
      void this.deps.tagWriter.renameTagPrefix(node.tagPath, newTagPath);
      // Not enough to just close the inline-edit field: the render this
      // triggers can still read the pre-rename tag from a not-yet-updated
      // cache and briefly show the old label, corrected a moment later by
      // the VaultIndex subscription — better than leaving the field stuck
      // in edit mode until then.
      this.renderTree();
    } else {
      this.pendingGroups = this.pendingGroups.map((p) =>
        p.group.tagPath === node.tagPath
          ? { parentTagPath: parentScope, group: { ...p.group, id: `group:${newTagPath}`, label, tagPath: newTagPath } }
          : p,
      );
      this.renderTree();
    }
  }

  /** Rebuilds only the tree content — never the header/search bar, which is
   * built once in onOpen and must survive re-renders (see the
   * searchComponent field's doc comment). Called on every vault/metadata
   * change plus every local interaction (click, drag, rename). */
  private renderTree() {
    const filesContainer = this.filesContainerEl;
    if (!filesContainer) return;
    filesContainer.empty();
    this.dropHoverEl = null;

    this.renderOrder = [];
    this.nodesById = new Map();
    this.scopeById = new Map();

    if (!this.rootTag) {
      const empty = filesContainer.createEl("div", { cls: "tree-view-empty-state" });
      const prompt = empty.createEl("div", { cls: "clickable-icon", text: "Pick a tag to start this view..." });
      prompt.addEventListener("click", () => this.focusSearch());
      this.realTagPaths = new Set();
      this.lastRootNodes = [];
      return;
    }

    const resolved = resolveTagRootView(this.rootTag, this.deps.index);
    this.realTagPaths = new Set(this.collectTagPaths(resolved));

    let nodes = resolved;
    for (const pending of this.pendingGroups) {
      nodes = insertPendingGroup(nodes, this.rootTag, pending.parentTagPath, pending.group);
    }
    this.lastRootNodes = nodes;

    this.renderNodes(filesContainer, nodes, this.rootTag);
  }

  private collectTagPaths(nodes: VirtualNode[]): string[] {
    const out: string[] = [];
    for (const n of nodes) {
      if (n.kind === "group") {
        out.push(n.tagPath);
        out.push(...this.collectTagPaths(n.children));
      }
    }
    return out;
  }

  private renderNodes(parentEl: HTMLElement, nodes: VirtualNode[], scope: string) {
    for (const node of nodes) {
      this.renderOrder.push(node.id);
      this.nodesById.set(node.id, node);
      this.scopeById.set(node.id, scope);
      if (node.kind === "file") {
        this.renderFile(parentEl, node);
      } else {
        this.renderGroup(parentEl, node, scope);
      }
    }
  }

  private renderFile(parentEl: HTMLElement, node: Extract<VirtualNode, { kind: "file" }>) {
    const item = parentEl.createEl("div", { cls: "tree-item nav-file" });
    const title = item.createEl("div", { cls: "tree-item-self is-clickable nav-file-title" });
    if (this.selected.has(node.id)) title.addClass("is-selected");
    title.setAttr("draggable", "true");
    title.setAttr("data-path", node.path);
    title.dataset.nodeId = node.id;
    title.createEl("div", {
      cls: "tree-item-inner nav-file-title-content",
      text: basename(node.path),
    });

    title.addEventListener("click", (ev) => this.handleItemClick(ev, node));
    title.addEventListener("contextmenu", (ev) => this.openContextMenu(ev, node));
    title.addEventListener("dragstart", (ev) => {
      const af = this.app.vault.getAbstractFileByPath(node.path);
      if (af) startObsidianDrag(this.app, ev, af, "tree-view");
      ev.dataTransfer?.setData(INTERNAL_DRAG_TYPE, node.id);
    });
  }

  private renderGroup(parentEl: HTMLElement, node: GroupNode, parentScope: string) {
    const isCollapsed = this.collapsed.has(node.id);
    const isEditing = this.editingNodeId === node.id;

    const item = parentEl.createEl("div", { cls: "tree-item nav-folder" });
    if (isCollapsed) item.addClass("is-collapsed");
    const title = item.createEl("div", {
      cls: "tree-item-self is-clickable mod-collapsible nav-folder-title",
    });
    if (this.selected.has(node.id)) title.addClass("is-selected");
    title.setAttr("draggable", isEditing ? "false" : "true");
    // File rows carry a real vault path in data-path, which themes (e.g.
    // AnuPpuccin, see the class's header comment) key their per-row icon
    // injection off. A group here has no real path — using its tagPath as
    // a stand-in gives the theme something to hang a folder icon on too,
    // so folder and file rows get equal-width icons and their labels stay
    // left-aligned with each other instead of files sitting shifted right.
    title.setAttr("data-path", node.tagPath);
    title.dataset.nodeId = node.id;

    const collapseIcon = title.createEl("div", { cls: "tree-item-icon collapse-icon" });
    if (isCollapsed) collapseIcon.addClass("is-collapsed");
    setIcon(collapseIcon, "right-triangle");

    if (isEditing) {
      this.renderInlineRename(title, node.label, node, parentScope);
    } else {
      title.createEl("div", {
        cls: "tree-item-inner nav-folder-title-content",
        text: node.label,
      });
      title.addEventListener("click", (ev) => this.handleItemClick(ev, node));
    }
    title.addEventListener("contextmenu", (ev) => this.openContextMenu(ev, node));
    title.addEventListener("dragstart", (ev) => {
      ev.dataTransfer?.setData(INTERNAL_DRAG_TYPE, node.id);
    });

    if (!isCollapsed) {
      const childrenEl = item.createEl("div", { cls: "tree-item-children nav-folder-children" });
      this.renderNodes(childrenEl, node.children, node.tagPath);
    }
  }

  private findRowAtY(clientY: number): HTMLElement | null {
    const rows = this.contentEl.querySelectorAll<HTMLElement>(".tree-item-self");
    for (const row of Array.from(rows)) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return row;
    }
    return null;
  }

  private setDropHover(rowEl: HTMLElement | null) {
    if (this.dropHoverEl && this.dropHoverEl !== rowEl) {
      this.dropHoverEl.removeClass("is-being-dragged-over");
    }
    this.dropHoverEl = rowEl;
    rowEl?.addClass("is-being-dragged-over");
  }

  /** Resolve which tag a drop over `rowEl` should target: the row's own
   * tagPath if it's a group, otherwise that row's enclosing scope — no row
   * (empty space) means the view's own root tag. */
  private resolveDropScope(rowEl: HTMLElement | null): string | undefined {
    if (!this.rootTag) return undefined;
    const nodeId = rowEl?.dataset.nodeId;
    if (!nodeId) return this.rootTag;
    const node = this.nodesById.get(nodeId);
    if (node?.kind === "group") return node.tagPath;
    return this.scopeById.get(nodeId) ?? this.rootTag;
  }

  private handleDelegatedDrop(
    ev: DragEvent,
    draggable: ObsidianDraggable | undefined,
    isDragOver: boolean,
  ): DropResult | undefined {
    const rowEl = this.findRowAtY(ev.clientY);

    const isInternal = ev.dataTransfer?.types.includes(INTERNAL_DRAG_TYPE) ?? false;
    const externalFiles = filesFromDraggable(draggable);
    if (!isInternal && externalFiles.length === 0) {
      this.setDropHover(null);
      return undefined;
    }

    if (!isDragOver) {
      this.setDropHover(null);
      this.performDrop(ev, isInternal, externalFiles, this.resolveDropScope(rowEl));
      return { dropEffect: "move" };
    }

    this.setDropHover(rowEl);
    return { dropEffect: "move" };
  }

  private performDrop(
    ev: DragEvent,
    isInternal: boolean,
    externalFiles: ReturnType<typeof filesFromDraggable>,
    targetTagPath: string | undefined,
  ) {
    if (!targetTagPath) return;

    if (isInternal) {
      const draggedId = ev.dataTransfer?.getData(INTERNAL_DRAG_TYPE);
      if (!draggedId) return;
      const node = this.nodesById.get(draggedId);
      if (!node) return;

      if (node.kind === "file") {
        if (node.sourceTag === targetTagPath) return;
        void this.deps.tagWriter
          .removeTag(node.path, node.sourceTag)
          .then(() => this.deps.tagWriter.addTag(node.path, targetTagPath));
      } else {
        if (targetTagPath === node.tagPath || targetTagPath.startsWith(`${node.tagPath}/`)) return;
        const newTagPath = `${targetTagPath}/${node.label}`;
        if (newTagPath === node.tagPath) return;
        if (this.realTagPaths.has(node.tagPath)) {
          void this.deps.tagWriter.renameTagPrefix(node.tagPath, newTagPath);
        } else {
          this.pendingGroups = this.pendingGroups.map((p) =>
            p.group.tagPath === node.tagPath
              ? { parentTagPath: targetTagPath, group: { ...p.group, id: `group:${newTagPath}`, tagPath: newTagPath } }
              : p,
          );
          this.renderTree();
        }
      }
    } else {
      const files = externalFiles.filter((f): f is TFile => f instanceof TFile);
      if (files.length === 0) return;
      for (const f of files) void this.deps.tagWriter.addTag(f.path, targetTagPath);
    }
  }
}
