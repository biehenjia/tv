/**
 * Implements core/vault-index.ts's VaultIndex against the real Obsidian API.
 * This is the only place that should translate `app.vault` /
 * `app.metadataCache` shapes into the domain's FileMeta shape.
 */
import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import type { FileMeta, VaultChangeEvent, VaultIndex } from "../core/vault-index";

/** `isUserIgnored` isn't in obsidian.d.ts, but it's the real, widely-relied-
 * on method backing Settings → Files & Links → "Excluded files" — the same
 * list Graph view and search already exclude by. Reusing it means tag views
 * respect whatever a user has already curated there, with no new settings
 * UI or persistence of our own. */
interface MetadataCacheWithIgnore {
  isUserIgnored?(path: string): boolean;
}

function toFileMeta(app: App, path: string): FileMeta | undefined {
  if ((app.metadataCache as unknown as MetadataCacheWithIgnore).isUserIgnored?.(path)) return undefined;
  const af = app.vault.getAbstractFileByPath(path);
  if (!af) return undefined;

  if (af instanceof TFolder) {
    return { path: af.path, isFolder: true, tags: [], frontmatter: {} };
  }
  if (af instanceof TFile) {
    const cache = app.metadataCache.getFileCache(af);
    const frontmatterTags: unknown = cache?.frontmatter?.tags;
    const tags = Array.isArray(frontmatterTags) ? [...new Set(frontmatterTags.map(String))] : [];
    return {
      path: af.path,
      isFolder: false,
      tags,
      frontmatter: cache?.frontmatter ?? {},
    };
  }
  return undefined;
}

export class ObsidianVaultIndex implements VaultIndex {
  constructor(private app: App) {}

  listFiles(): FileMeta[] {
    return this.app.vault
      .getAllLoadedFiles()
      .map((f) => toFileMeta(this.app, f.path))
      .filter((f): f is FileMeta => f !== undefined);
  }

  getFile(path: string): FileMeta | undefined {
    return toFileMeta(this.app, path);
  }

  listTags(): string[] {
    const tags = new Set<string>();
    for (const f of this.listFiles()) {
      for (const t of f.tags) tags.add(t);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  onChange(handler: (event: VaultChangeEvent) => void): () => void {
    const onCreate = (f: TAbstractFile) => handler({ type: "create", path: f.path });
    const onDelete = (f: TAbstractFile) => handler({ type: "delete", path: f.path });
    const onRename = (f: TAbstractFile, oldPath: string) =>
      handler({ type: "rename", path: f.path, oldPath });
    // `vault.on("modify")` fires as soon as the file is *written*, which can
    // race ahead of metadataCache re-parsing it — reading tags right then
    // can still see the old frontmatter. `metadataCache.on("changed")` is
    // the event that actually means "the cache this class reads from is now
    // up to date," so it's what tag-view re-renders need to wait for, not
    // "modify".
    const onMetadataChanged = (f: TAbstractFile) => handler({ type: "modify", path: f.path });

    const refs = [
      this.app.vault.on("create", onCreate),
      this.app.vault.on("delete", onDelete),
      this.app.vault.on("rename", onRename),
      this.app.metadataCache.on("changed", onMetadataChanged),
    ];

    return () => {
      this.app.vault.offref(refs[0]);
      this.app.vault.offref(refs[1]);
      this.app.vault.offref(refs[2]);
      this.app.metadataCache.offref(refs[3]);
    };
  }
}
