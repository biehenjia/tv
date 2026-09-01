/**
 * Fuzzy picker over every file/folder in the vault, used by the "+" action on
 * a tree view pane to add a manual reference. Pure UI shell — picking a
 * result just hands the chosen path back via the onChoose callback.
 */
import { App, FuzzySuggestModal, TAbstractFile, TFolder } from "obsidian";

export class FileSuggestModal extends FuzzySuggestModal<TAbstractFile> {
  constructor(
    app: App,
    private onChoose: (file: TAbstractFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Add a file or folder to this view...");
  }

  getItems(): TAbstractFile[] {
    return this.app.vault.getAllLoadedFiles();
  }

  getItemText(item: TAbstractFile): string {
    return item instanceof TFolder ? `${item.path}/` : item.path;
  }

  onChooseItem(item: TAbstractFile): void {
    this.onChoose(item);
  }
}
