/**
 * Composition root. Wires adapters into core and registers the UI view
 * types. Nothing here contains tree/view logic itself — it delegates to
 * core/ and instantiates adapters/ui with real Obsidian objects.
 *
 * A tag view has no backing vault file (see ui/view-pane.ts's header) — its
 * only state is a root tag, kept in leaf state and restored by Obsidian's
 * own workspace.json, the same way it remembers which file a normal editor
 * tab had open. There's nothing for this file to persist itself.
 */
import { Plugin, WorkspaceLeaf } from "obsidian";
import { ObsidianVaultIndex } from "./adapters/obsidian-vault-index";
import { ObsidianTagWriter } from "./adapters/obsidian-tag-writer";
import { TreeViewPane, TREE_VIEW_TYPE } from "./ui/view-pane";
import { TagBrowserPane, TAG_BROWSER_VIEW_TYPE } from "./ui/tag-browser-pane";

type Placement = "left" | "right" | "main";

export default class TreeViewPlugin extends Plugin {
  private index!: ObsidianVaultIndex;
  private tagWriter!: ObsidianTagWriter;

  async onload() {
    this.index = new ObsidianVaultIndex(this.app);
    this.tagWriter = new ObsidianTagWriter(this.app);

    this.registerView(
      TREE_VIEW_TYPE,
      (leaf) => new TreeViewPane(leaf, { index: this.index, tagWriter: this.tagWriter }),
    );
    this.registerView(
      TAG_BROWSER_VIEW_TYPE,
      (leaf) => new TagBrowserPane(leaf, { index: this.index, onOpenTag: (tag) => void this.openTagView("left", tag) }),
    );

    this.addCommand({
      id: "open-tag-view",
      name: "Open tag view",
      callback: () => void this.openTagView("left"),
    });
    this.addCommand({
      id: "open-tag-view-main",
      name: "Open a new tag view in the main area",
      callback: () => void this.openFreshTagView("main"),
    });
    this.addCommand({
      id: "open-tag-browser",
      name: "Open tag browser",
      callback: () => void this.openOrReveal(TAG_BROWSER_VIEW_TYPE, "right"),
    });
  }

  // No onunload(): registerView already unregisters the view factories, and
  // Obsidian restores open leaves of an unregistered type once the plugin
  // reloads. Detaching them here would wipe the user's layout on every
  // update. See https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

  /** Reveal/create the tag view pane (the one that lives in the sidebar
   * like core Bookmarks — reveals whichever one is already open regardless
   * of placement, same as openOrReveal), then either root it at `tag` or,
   * with none given, just focus its search bar. Shared by the "Open tag
   * view" command and every click in the tag browser pane. */
  private async openTagView(placement: Placement, tag?: string) {
    let leaf = this.app.workspace.getLeavesOfType(TREE_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.resolveLeaf(placement);
      await leaf.setViewState({ type: TREE_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    const pane = leaf.view;
    if (!(pane instanceof TreeViewPane)) return;
    if (tag) pane.setRootTag(tag);
    else pane.focusSearch();
  }

  /** Always opens a brand-new tag-view pane, e.g. for a working copy in the
   * main area alongside the sidebar one (easier drag-and-drop target). */
  private async openFreshTagView(placement: Placement) {
    const leaf = this.resolveLeaf(placement);
    await leaf.setViewState({ type: TREE_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const pane = leaf.view;
    if (pane instanceof TreeViewPane) pane.focusSearch();
  }

  /** Reveals whichever leaf of `viewType` is already open, regardless of
   * placement, rather than piling up duplicates; only creates one if none
   * exists yet. */
  private async openOrReveal(viewType: string, placement: Placement) {
    const existing = this.app.workspace.getLeavesOfType(viewType)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.resolveLeaf(placement);
    await leaf.setViewState({ type: viewType, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private resolveLeaf(placement: Placement): WorkspaceLeaf {
    if (placement === "left") return this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeaf("tab");
    if (placement === "right") return this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
    return this.app.workspace.getLeaf("split", "vertical");
  }
}
