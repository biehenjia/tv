/**
 * The one place a tag view mutates real files: adding/removing/renaming a
 * frontmatter `tags:` entry. Everything else in this plugin only reads the
 * vault — this is a deliberate, narrow exception (see core/view.ts's
 * header), scoped to exactly what dragging a file into/out of/between
 * branches, or renaming a branch, needs to do.
 */
import { App, TFile } from "obsidian";
import { remapTagPrefix } from "../core/operations";

/** `processFrontMatter` hands the callback an untyped object; treat it as a
 * bag of unknowns and narrow explicitly rather than trusting `any`. */
type FrontMatter = Record<string, unknown>;

/** frontmatter `tags` as a string[] — empty when it's absent or not a list. */
function frontMatterTags(fm: FrontMatter): string[] {
  const raw = fm.tags;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((t) => String(t));
}

export class ObsidianTagWriter {
  constructor(private app: App) {}

  async addTag(path: string, tag: string): Promise<void> {
    const file = this.fileAt(path);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm: FrontMatter) => {
      const tags = frontMatterTags(fm);
      if (!tags.includes(tag)) tags.push(tag);
      fm.tags = tags;
    });
  }

  async removeTag(path: string, tag: string): Promise<void> {
    const file = this.fileAt(path);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm: FrontMatter) => {
      if (!Array.isArray(fm.tags)) return;
      fm.tags = frontMatterTags(fm).filter((t) => t !== tag);
    });
  }

  /** Renames a tag prefix across every file in the vault that has it —
   * exact match or anything nested under it (core/operations.ts's
   * remapTagPrefix). Backs both "rename this branch" and "drag this whole
   * branch under a different parent." Applied immediately, no confirmation
   * — by design, even though it can touch many files in one call. */
  async renameTagPrefix(oldPrefix: string, newPrefix: string): Promise<void> {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const tags: unknown = cache?.frontmatter?.tags;
      if (!Array.isArray(tags)) continue;
      const touched = tags.map(String).some((t) => t === oldPrefix || t.startsWith(`${oldPrefix}/`));
      if (!touched) continue;
      await this.app.fileManager.processFrontMatter(file, (fm: FrontMatter) => {
        if (!Array.isArray(fm.tags)) return;
        fm.tags = frontMatterTags(fm).map((t) => remapTagPrefix(t, oldPrefix, newPrefix));
      });
    }
  }

  /** Strips a tag prefix — exact match or anything nested under it — from
   * every file that has it. Backs "remove this whole branch from the view."
   * Applied immediately, same as renameTagPrefix. */
  async removeTagPrefix(prefix: string): Promise<void> {
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const tags: unknown = cache?.frontmatter?.tags;
      if (!Array.isArray(tags)) continue;
      const touched = tags.map(String).some((t) => t === prefix || t.startsWith(`${prefix}/`));
      if (!touched) continue;
      await this.app.fileManager.processFrontMatter(file, (fm: FrontMatter) => {
        if (!Array.isArray(fm.tags)) return;
        fm.tags = frontMatterTags(fm).filter((t) => t !== prefix && !t.startsWith(`${prefix}/`));
      });
    }
  }

  private fileAt(path: string): TFile | undefined {
    const af = this.app.vault.getAbstractFileByPath(path);
    return af instanceof TFile ? af : undefined;
  }
}
