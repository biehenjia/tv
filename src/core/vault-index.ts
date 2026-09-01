/**
 * The minimal read model `core/` needs from the vault. Implemented for real
 * by adapters/obsidian-vault-index.ts; fakeable in-memory for tests. This is
 * the seam that keeps `core/` free of any `obsidian` import.
 */
import type { FilePath } from "./view";

export interface FileMeta {
  path: FilePath;
  isFolder: boolean;
  /** frontmatter `tags:` only — inline `#tags` in the body are deliberately
   * not read here, tag views are frontmatter-only by convention. */
  tags: string[];
  frontmatter: Record<string, unknown>;
}

export type VaultChangeEvent =
  | { type: "create" | "delete" | "modify"; path: FilePath }
  | { type: "rename"; path: FilePath; oldPath: FilePath };

export interface VaultIndex {
  listFiles(): FileMeta[];
  getFile(path: FilePath): FileMeta | undefined;
  /** every distinct frontmatter tag in the vault, sorted — backs the header
   * search bar's dropdown in ui/tag-root-suggest.ts */
  listTags(): string[];
  /** subscribe to vault changes; returns an unsubscribe function */
  onChange(handler: (event: VaultChangeEvent) => void): () => void;
}
