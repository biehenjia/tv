/**
 * Type-ahead dropdown for the header search bar that switches a tag view's
 * root tag — attaches directly to the SearchComponent's `<input>` via
 * Obsidian's own AbstractInputSuggest (the same primitive core uses for its
 * tag/file inputs), so it gets native dropdown positioning/keyboard nav for
 * free instead of a hand-rolled popover. Supersedes the old modal-based
 * TagSuggestModal — one interaction surface instead of two.
 */
import { AbstractInputSuggest, App } from "obsidian";

export class TagRootInputSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private getTags: () => string[],
    private onChoose: (tag: string) => void,
  ) {
    super(app, inputEl);
    this.onSelect((tag) => {
      this.setValue(tag);
      this.close();
      this.onChoose(tag);
    });
  }

  getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase();
    const tags = this.getTags();
    const matches = tags.filter((t) => t.toLowerCase().includes(q));
    const exact = tags.some((t) => t.toLowerCase() === q);
    // Offer the raw typed value too, so you can point the root at a tag
    // nothing has used yet — same fallback the old TagSuggestModal had.
    return q && !exact ? [...matches, query.trim()] : matches;
  }

  renderSuggestion(tag: string, el: HTMLElement): void {
    el.setText(this.getTags().includes(tag) ? tag : `+ New tag root "${tag}"`);
  }
}
