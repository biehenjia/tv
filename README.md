# Tree View

Create multiple editable file-explorer views that reference the vault's real file
tree, without altering it.

## What it does

Tree View adds two panes to Obsidian:

- **Tag view** — a live file tree computed from your notes' frontmatter tags,
  rooted at a tag you pick. Drag notes in, out, or between branches and the plugin
  rewrites the underlying frontmatter tags for you; rename a branch and every note
  under it is retagged. You can open several tag views at once, each rooted
  differently, in the sidebar or the main area. A tag view has no file of its own
  — its root tag is remembered by Obsidian's workspace, like any other tab.
- **Tag browser** — a read-only tree of every tag in the vault (a drop-in
  alternative to core's Tags pane). Clicking a tag opens or re-roots the tag view
  instead of running a global search.

Both panes mirror Obsidian's own File Explorer / Tags markup, so your active theme
styles them with no extra CSS.

### Commands

- **Open tag view** — reveal/create the sidebar tag view
- **Open a new tag view in the main area** — always a fresh pane
- **Open tag browser** — reveal/create the tag browser in the right sidebar

## Install

### Community plugins

Once approved: **Settings → Community plugins → Browse**, search for "Tree View",
install, and enable.

### BRAT (beta)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Run **BRAT: Add a beta plugin for testing** and enter
   `https://github.com/biehenjia/tv`.
3. Enable **Tree View** under Community plugins.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the
[latest release](https://github.com/biehenjia/tv/releases) and copy them into
`<vault>/.obsidian/plugins/tree-view/`, then enable the plugin.

## Build from source

```
npm install
npm run build
```

`npm run build` type-checks with `tsc` and bundles `src/main.ts` into `main.js`
via esbuild. Use `npm run dev` for a watch build.

## License

MIT — see [LICENSE](LICENSE).
