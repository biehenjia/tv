/**
 * Wraps Obsidian's internal drag manager — the same undocumented plumbing
 * the core File Explorer, Bookmarks pane, and tab headers all build on top
 * of (`app.dragManager.handleDrag`/`handleDrop`), rather than us hand-rolling
 * native `dragover`/`drop` wiring. Isolated here so the rest of the plugin
 * never touches `app.dragManager` directly. Reverse-engineered from
 * Obsidian's own app.js:
 *  - `dragFile`/`dragFolder`/`dragFiles` register a drag with the global
 *    `draggable` descriptor the native ghost tracks.
 *  - `handleDrag(el, fn)` wires an element's dragstart to call `fn(event)`
 *    and register whatever descriptor it returns.
 *  - `handleDrop(el, fn, force)` is a *single delegated* listener — attach
 *    once to a container, not per-row. It fires `fn(event, draggable,
 *    isDragOver)` on dragover/dragenter (isDragOver=true) and on drop
 *    (isDragOver=false); a truthy return auto-calls preventDefault, sets the
 *    cursor via `dropEffect`, and can highlight `hoverEl` with `hoverClass`
 *    (that highlight helper only supports one class per element, not the
 *    three before/after/inside states this plugin needs, so callers manage
 *    their own highlight classes instead of relying on it).
 */
import { App, TAbstractFile, TFolder } from "obsidian";

export interface ObsidianDraggable {
  type: string;
  file?: TAbstractFile;
  files?: TAbstractFile[];
}

export interface DropResult {
  dropEffect?: "move" | "copy" | "link";
  action?: string;
  hoverEl?: HTMLElement;
  hoverClass?: string;
}

type DropCallback = (ev: DragEvent, draggable: ObsidianDraggable | undefined, isDragOver: boolean) => DropResult | undefined;

interface DragManagerLike {
  dragFile?: (ev: DragEvent, file: TAbstractFile, source: string) => ObsidianDraggable;
  dragFolder?: (ev: DragEvent, folder: TFolder, source: string) => ObsidianDraggable;
  handleDrop?: (el: HTMLElement, fn: DropCallback, force?: boolean) => void;
}

interface AppWithDragManager {
  dragManager?: DragManagerLike;
}

export function filesFromDraggable(draggable: ObsidianDraggable | undefined): TAbstractFile[] {
  if (!draggable) return [];
  if (draggable.type === "files" && draggable.files) return draggable.files;
  if (draggable.file) return [draggable.file];
  return [];
}

/**
 * Register a drag as originating from us using Obsidian's own dragFile/
 * dragFolder, so the native drag ghost/preview renders and tracks the
 * cursor exactly like a drag started from the core File Explorer. No-ops if
 * the internal API isn't present — the plugin's own dataTransfer key still
 * carries the actual move, this is purely for the native visual.
 */
export function startObsidianDrag(app: App, ev: DragEvent, file: TAbstractFile, source: string): void {
  const manager = (app as unknown as AppWithDragManager).dragManager;
  if (!manager) return;
  if (file instanceof TFolder) manager.dragFolder?.(ev, file, source);
  else manager.dragFile?.(ev, file, source);
}

/**
 * Register a single delegated drop target on `el` (call once — e.g. a
 * pane's contentEl — not per row), using Obsidian's own dragManager instead
 * of raw dragover/drop listeners. `force=true` means the callback still
 * fires even when nothing is currently registered in `dragManager.draggable`
 * (e.g. a raw OS file drag), matching what real Obsidian panes pass.
 * Returns a no-op unregister function if dragManager.handleDrop isn't
 * available (nothing to clean up in that case).
 */
export function registerDropTarget(app: App, el: HTMLElement, callback: DropCallback, force = true): void {
  const manager = (app as unknown as AppWithDragManager).dragManager;
  manager?.handleDrop?.(el, callback, force);
}
