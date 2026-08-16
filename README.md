# select-list

Provides a fuzzy-searchable select-list and modal panel component.

This CommonJS [etch component](https://github.com/lumine-code/etch) provides keyboard and mouse navigation with built-in panel management. It is derived from Atom's [select-list](https://github.com/atom/select-list) and is maintained for Lumine's editor runtime.

## Features

- **Fuzzy filtering**: Multiple algorithms including `command-t` for file paths.
- **Match highlighting**: A `highlight` function handed to every row renderer.
- **Panel management**: Show/hide/toggle with focus restoration.
- **Lazy match indices**: Match positions computed only when accessed.
- **Diacritics support**: Accent-insensitive matching option.
- **One message line**: Loading, status, and resting info resolve by precedence, with severities and self-clearing messages.
- **Recent items**: An id list hoists the rows last used and rules them off from the rest.
- **Managed query**: Cleared on every open, kept across a flow step, remembered on close, restored on demand.
- **Dialog base**: `InputDialogView` exposes the modal panel, query editor, and focus behavior for dialogs that are not lists.

## Installation

```sh
npm install @lumine-code/select-list
```

Inside Lumine there is nothing to install: the editor ships this component and hands it out through `lumine.workspace.buildSelectList(props)` and `lumine.workspace.buildInputDialog(props)`. A package should use those rather than depending on this module directly.

## The message line

A dialog shows **one** message at a time, above the list. Three props feed it, and the component picks between them in precedence order:

1. `loadingMessage` — work is in flight. Rendered with a spinner, and with `loadingBadge` beside it when progress arrives in batches.
2. `status` — an episodic message: a validation failure, a warning, a confirmation.
3. `infoMessage` — the resting line, shown when neither of the above is.

Nothing stacks. A status does not destroy the resting line, it covers it, so clearing the status brings the line back with nothing to save and restore.

```js
view.update({ status: { type: "error", message: "Enter a branch name." } });
view.update({ status: { type: "warning", message: "This overwrites bird.png." } });
view.update({ status: { type: "info", message: "Copied", duration: 2000 } });
view.update({ status: null }); // back to the resting infoMessage
```

- `type: "info" | "warning" | "error"` — defaults to `"info"`. It selects the theme's own `text-info` / `text-warning` / `text-error` colour, and an `error` carries `role="alert"` where the others carry `role="status"`.
- `message: String` — the text. Newlines are preserved.
- `duration: Number` — milliseconds, after which the status clears itself. Anything that replaces the status cancels a pending expiry first, so a timer from a superseded message can never wipe a newer one.
- `sticky: Boolean` — keep the status when the query changes. **By default a status is cleared on the next query change**, because it was raised in answer to the query it appeared under. Set this for a status that did not come from the input at all — a background refresh that failed, say.

Errors that are not about the dialog's own input belong in `lumine.notifications`, not here. The rule of thumb: if the user can fix it by typing something else, it is a `status`; if it needs an action elsewhere, it is a notification.

## The query

The query belongs to the dialog, not to the caller. **It is cleared on every fresh show**, so a consumer never calls `reset()` before `show()` — and the several packages that used to were all writing the same line for the same reason.

Two things are deliberately not a fresh show:

- **A modal-flow round trip.** Opening the actions list and coming back is a resume, not an opening; clearing there would throw away the query the action is about to act on.
- **`preserveQuery: true`.** The query survives every open, and is selected on arrival so the next keystroke still replaces it. For a dialog whose last answer is usually the next one.

Whatever the query was when the dialog closed is remembered, and `select-list:restore-query` (F11) puts it back, selected. That is the on-demand half of `preserveQuery`: the list opens clean, and the previous query is one key away rather than in the way.

## Recent items

`recentIds` is an array of item identifiers, most recently used first, resolved through the same `idForItem` as `separatorIds`. While the query is empty the list hoists those items to the top in that order and draws its own separator under them; under a query the rows are ranked by score and neither happens, because reordering a search result would be overriding the answer the user asked for.

```js
this.selectList.update({ items: this.items, recentIds: this.recentlyUsed });
```

The list orders and marks; it stores nothing. How many entries to keep, when to record one, and whether they survive a restart stay with the package, which is the only side that knows what its items are:

```js
recordRecent(item) {
  const index = this.recentlyUsed.indexOf(item.aPath);
  if (index !== -1) this.recentlyUsed.splice(index, 1);
  this.recentlyUsed.unshift(item.aPath);
  this.recentlyUsed.length = Math.min(this.recentlyUsed.length, this.recentCount);
}
```

An id in `recentIds` that no longer matches an item is ignored, so a list never has to prune entries against its own contents before handing them over.

## Upgrading to 6.0.0

The three independent message props became one line with a precedence, and the spinner stopped being optional.

- `errorMessage: "…"` → `status: { type: "error", message: "…" }`.
- `loadingSpinner` is gone — delete it. The spinner always renders with `loadingMessage`, and it replaces the hourglass glyph the stylesheet used to add.
- Clearing a message by hand on every query change is no longer needed. Drop the `didChangeQuery` handler that did it, or pass `sticky: true` on the statuses that should survive a keystroke.
- Hand-rolled auto-dismiss — a `setTimeout` that nulls the message — becomes `duration`.
- `infoMessage` is unchanged, but it is now covered rather than accompanied by a loading or status message.
- `SelectListView` elements now carry **both** `input-dialog` and `select-list` classes, mirroring the class hierarchy. A stylesheet rule that means dialogs and not lists is written `.input-dialog:not(.select-list)`.
- The query is cleared on every show. Delete the `reset()` call before `show()`, and the config or flag that decided whether to make it — `preserveQuery: true` is the whole of the opt-out, and F11 covers the case that motivated most of those flags.
- Hand-rolled recent sections — an `order` that hoists recents while the query is empty plus a `separatorIds` computed from the first non-recent item — become `recentIds`. Keep the storage, delete the ordering.
- The item-actions list is grouped. An action that acts on the list rather than the selected row declares `actionScope: "list"` where it is registered; everything else is unchanged.

## Upgrading to 4.0.0

The module now exports the two view classes and nothing else. The standalone helpers — `highlightMatches`, `createTwoLineItem`, `createTrailingBlock`, `getMatchIndices` and `removeDiacritics` — are gone from the public surface.

- `highlightMatches(text, matchIndices)` → `highlight(text)` from the `elementForItem` options. Pass indices as a second argument when they are not the item's own.
- `createTwoLineItem({...})` → return that same object from `elementForItem` instead of an element.
- `removeDiacritics(str)` → `lumine.tools.removeDiacritics(str)`.
- `getMatchIndices(text, query)` → `options.matchIndices` inside `elementForItem`, or `lumine.tools.fuzzyMatcher` directly outside one.

## API

### Constructor props

When creating a new instance of a select list, or when calling `update` on an existing one, you can supply a JavaScript object that can contain any of the following properties:

#### Required

- `elementForItem: (item: Object, options: Object) -> HTMLElement|Object`: a function that is called whenever an item needs to be displayed. Return an `HTMLElement` to render it as-is, or a plain descriptor object to have a two-line row built for you — see [Rendering rows](#rendering-rows).
  - `options: Object`:
    - `selected: Boolean`: indicating whether item is selected or not.
    - `index: Number`: item's index.
    - `filterKey: String|null`: the text that was matched against (from `filterKeyForItem` or item itself).
    - `matchIndices: [Number]|null`: lazy getter - character indices in `filterKey` that matched the query. Only computed when accessed.
    - `highlight: (text: String, indices?: [Number]) -> DocumentFragment`: wraps the matched characters of `text` in `span.character-match`. Defaults to this item's own `matchIndices`; pass `indices` explicitly when the text being rendered is not the filter key.
    - `visible: Boolean`: `false` only when `initiallyVisibleItemCount` is set and the item is still outside the visible area; return a cheap placeholder element (e.g. an empty `li`) in that case — the item re-renders with `visible: true` once scrolled into view.

#### Optional

- `items: [Object]`: an array containing the objects you want to show in the select list.
- `className: String`: CSS class name(s) to add to the select list element. Multiple classes can be space-separated.
- `maxResults: Number`: the batch size of the list — how many matches render before a library-owned "Show more…" row reveals the next batch (defaults to `99`). Confirming or clicking that row expands in place — and keyboard navigation never has to press it: the moment the selection would touch the row, the list expands and the selection continues into the first newly revealed item, with the scroller keeping its position. The row is chrome — it never reaches `elementForItem`, `filterKeyForItem`, or the selection callbacks, and `getSelectedItem()` answers `null` while it is highlighted. A query or items change starts from the base cap again.
- `filter: (items: [Object], query: String) -> [Object]`: a function that allows to decide which items to show whenever the query changes. By default, it uses Lumine's built-in fuzzy matcher.
- `filterKeyForItem: (item: Object) -> String`: when `filter` is not provided, this function will be called to retrieve a string property on each item and that will be used to filter them.
- `filterQuery: (query: String) -> String`: a function that allows to apply a transformation to the user query and whose return value will be used to filter items.
- `removeDiacritics: Boolean`: when `true`, removes diacritical marks from both the query and item text before filtering, enabling accent-insensitive matching (e.g., "cafe" matches "café").
- `filterScoreModifier: (score: Number, item: Object) -> Number`: a function to modify the fuzzy match score for each item. Useful for applying custom ranking factors (e.g., boosting by recency or proximity).
- `algorithm: String`: the fuzzy matching algorithm to use. Options: `'fuzzaldrin'` (default), `'command-t'` (path-aware, better for file paths).
- `numThreads: Number`: number of threads for parallel matching. Defaults to 80% of available CPUs.
- `maxGap: Number`: maximum gap between consecutive matched characters (only for `'command-t'` algorithm). Lower values require tighter matches. Defaults to infinite.
- `query: String`: a string that will replace the contents of the query editor. Applied by `update` only — the constructor ignores it, so set the text through `update({query})` or `refs.queryEditor.setText()`.
- `selectQuery: Boolean`: a boolean indicating whether the query text should be selected or not. Applied by `update` only, as with `query`.
- `order: (item1: Object, item2: Object) -> Number`: a function that allows to change the order in which items are shown.
- `emptyMessage: String`: a string shown when the list has no items. It stands down while a loading or status message is showing — a failed load that also said "no results" would be reporting the same fact twice — but coexists with the resting `infoMessage`, since a stat line and "No matches found" are two different statements.
- `infoMessage: String`: the resting line — a prompt, a help text, a stat line. It is the dialog's own chrome, not an event, so it survives everything shown over it.
- `loadingMessage: String`: set while items are loading in the background. A spinner is rendered with it always; there is no option to suppress it.
- `loadingBadge: String/Number`: rendered beside the loading message, for progress that arrives in batches.
- `status: Object|null`: the episodic message — see [The message line](#the-message-line).
- `itemsClassList: [String]`: an array of strings that will be added as class names to the items element.
- `separatorIds: [String|Number]`: item identifiers before which the list inserts a standalone `li.select-list-separator` with `role="separator"`. Separators are list chrome: they are not selectable, filterable, counted by `maxResults`, or passed to consumer callbacks. Object items use their `id` property by default; primitive items identify themselves.
- `recentIds: [String|Number]`: item identifiers, most recently used first — see [Recent items](#recent-items).
- `preserveQuery: Boolean`: keep the query across opens instead of clearing it — see [The query](#the-query).
- `idForItem: (item: Object) -> String|Number`: returns the stable identifier compared with `separatorIds`, overriding the default described above.
- `contentElement: HTMLElement`: a caller-owned DOM element rendered below the list and messages. Interactive elements inside it (`input`, `textarea`, `select`, `button`, `a[href]`, `[tabindex]`, `lumine-text-editor`) can receive focus and clicks; anywhere else keeps focus in the query editor.
- `initialSelectionIndex: Number`: the index of the item to initially select; defaults to `0`, or to no selection at all when `allowEmptySelection` is set.
- `allowEmptySelection: Boolean`: treat "nothing selected" as a state of its own — the state in which confirming acts on the query rather than on a row. The list starts in it unless `initialSelectionIndex` says otherwise, and `core:move-up`/`core:move-down` return to it when they step off the top or the bottom, entering the list again at the far end on the next move. Without it the two ends wrap straight into each other, since there is nothing to pass through. `core:move-to-top` and `core:move-to-bottom` are asked for an end by name and always give one. A `Show more…` row still expands before the selection is emptied.
- `initiallyVisibleItemCount: Number`: render only the first N items eagerly; items beyond that count get `visible: false` in `elementForItem` and are re-rendered when scrolled into view (via `IntersectionObserver`). Useful for very long lists with expensive item rendering. Constructor-only — cannot be changed via `update`.
- `placeholderText: String`: placeholder text to display in the query editor when empty.
- `panelItem: Object`: the item passed to `lumine.workspace.addModalPanel` (defaults to the select list itself). Useful when a wrapper view should be exposed as `panel.item`; the object must have an `element` property. Constructor-only.
- `skipCommandsRegistration: Boolean`: when `true`, skips registering default keyboard commands.
- `headerElement: HTMLElement` and `checkboxes: [Object]` are inherited from `InputDialogView` and work here too; see [InputDialogView](#inputdialogview) for their shape.

### Registered commands

By default, the component registers these commands on its element:

- `core:move-up` / `core:move-down`: Navigate items
- `core:move-to-top` / `core:move-to-bottom`: Jump to first/last item
- `core:confirm`: Confirm selection
- `core:cancel`: Cancel selection
- `select-list:actions`: Show the item-actions list (F12)
- `select-list:restore-query`: Put back the query the dialog was last closed with (F11)

#### Callbacks

- `didChangeQuery: (query: String) -> Void`: called when the query changes.
- `didChangeSelection: (item: Object) -> Void`: called when the selected item changes.
- `didConfirmSelection: (item: Object) -> Void`: called when the user clicks or presses Enter on an item.
- `didConfirmEmptySelection: () -> Void`: called when the user presses Enter but the list is empty.
- `didCancelSelection: () -> Void`: called when the user presses Esc or the list loses focus.
- `willShow: () -> Void`: called whenever the panel becomes visible — a plain `show()`, a modal-flow step change, or a back navigation re-showing the list — useful for data preparation.
- `crumb: String`: the label this list carries on the workspace's modal breadcrumb trail, used when it is shown as a flow step without an explicit label and when a step shown on top of it adopts it as the trail root.
- `actionsFilter: (descriptor) -> Boolean`: which of the dialog's own commands the item-actions list offers. Defaults to everything the dialog contributes minus `core:*` and the built-in chrome commands.
- `skipItemActions: Boolean`: opt this list out of the item-actions list entirely.

`SelectListView` overrides `confirm()`/`cancel()` to route to `confirmSelection()`/`cancelSelection()`, so the base `didConfirm`/`didCancel` callbacks never fire on a select list. Use the `*Selection` callbacks above; `didConfirm`/`didCancel` are for `InputDialogView`.

### Instance properties

- `processedQuery: String`: The cached result of `getFilterQuery()`, updated after each query change. Useful in `elementForItem` to avoid calling `getFilterQuery()` multiple times.
- `selectionIndex: Number|undefined`: The index of the currently selected item, or `undefined` if nothing is selected.
- `refs.queryEditor`: The underlying TextEditor component for the query input.

### Instance methods

#### Panel management

- `show(options?)`: Shows the select list as a modal panel and focuses the query editor, running `willShow` first. Passing `{crumb: "Label"}` (or `crumb: true` to use the `crumb` prop) shows it as a step of the workspace's modal flow instead: the modal visible at that moment becomes the previous breadcrumb entry, and Shift-Escape or a click on an earlier crumb returns to it with its state intact. Escape still cancels the visible step, which ends the whole trail. The show side effects run whenever the panel becomes visible, whoever shows it.
- `hide()`: Hides the panel and restores focus to the previously focused element.
- `toggle()`: Toggles the visibility of the panel.
- `isVisible()`: Returns `true` if the panel is currently visible.
- `getPanel()`: Returns the modal panel hosting the select list, creating it hidden on first access.

#### Item actions

Defined on `InputDialogView`, so every select list _and_ every dialog offers them.

- `showItemActions()`: Shows the item-actions list as a modal-flow step (crumb "Actions") — the commands the dialog itself contributes, in the package's own namespace (`fuzzy-files:open`), with the label, description, and keybindings each carries in the command registry and keymaps, rendered command-palette style. Bound to F12 as `select-list:actions`; F12 pressed in the actions list itself goes back, so the key toggles. Confirming a row — or pressing an action's own keybinding right in the actions list, which wears the master's classes so the package keymap applies there untouched — returns to the master first and then dispatches the command, exactly as if the keystroke was pressed there. A package only has to register its commands with a `description` for the rows to explain themselves; nothing is declared twice.
- `itemActions()`: Returns the derived action descriptors (`{name, description, command, keystrokes, scope}`).
- `groupItemActions(actions)`: Returns `{items, separatorIds}` — the actions in display order with the group boundary marked.

An action is about the **selected row** or about the **list**: "open this file in a split" against "index the project again". The list shows the row actions first, then a separator, then the list actions, so the group a row belongs to is legible without reading it. A package declares the second kind where it registers the command:

```js
lumine.commands.add(this.selectList.element, {
  "fuzzy-files:split-right": {
    description: "Open the file in a pane to the right",
    didDispatch: () => this.performAction("split-right"),
  },
  "fuzzy-files:refresh-index": {
    description: "Scan the project again and rebuild the index",
    actionScope: "list",
    didDispatch: () => this.refresh(),
  },
});
```

`"item"` is the default, since most actions are one. The command registry keeps any key it does not recognise, so this needs nothing from the editor. The separator is drawn only while the actions list is unfiltered — under a query the two groups interleave by score, and a line anywhere in that would be meaningless.

#### Other methods

- `focus()`: Focuses the query editor.
- `reset()`: Clears the query editor text. Rarely needed — the query is cleared on every show.
- `restoreQuery()`: Puts back the query the dialog was last closed with, selected. Returns `false` when there was none.
- `destroy()`: Disposes of the component and cleans up resources.
- `update(props)`: Updates the component with new props.
- `getQuery()`: Returns the current query string.
- `getIdForItem(item)`: Returns the identifier used to match an item against `separatorIds`.
- `hasSeparatorBefore(item)`: Returns whether the current props request a separator immediately before an item.
- `getFilterKey(item)`: Returns the filter key string for an item (from cache, `filterKeyForItem`, or item itself).
- `getMatchIndices(item, filterKey?)`: Returns match indices for an item, computing lazily if needed. Prefer `options.highlight` — or `options.matchIndices` — in `elementForItem` instead.
- `getFilterQuery()`: Returns the filtered query string (applies `filterQuery` transformation).
- `setQueryFromSelection()`: Sets the query text from the active editor's selection. Returns `true` if successful, `false` if no editor, no selection, or selection contains newlines.
- `getSelectedItem()`: Returns the currently selected item.
- `selectPrevious()`: Selects the previous item.
- `selectNext()`: Selects the next item.
- `selectFirst()`: Selects the first item.
- `selectLast()`: Selects the last item.
- `selectNone()`: Deselects all items.
- `selectIndex(index)`: Selects the item at the given index.
- `selectItem(item)`: Selects the given item.
- `confirmSelection()`: Confirms the current selection.
- `cancelSelection()`: Cancels the selection.

### Static methods

#### `SelectListView.setScheduler(scheduler)`

Overrides the etch scheduler used by the component. The package points its own copy of etch at `lumine.views` when it loads inside the editor, so this is needed only to pin a scheduler of your own — a fake one in a test, say. It has to go through here because this package resolves its own copy of etch, which a caller holding a different copy cannot otherwise reach.

#### `SelectListView.getScheduler()`

Returns the current etch scheduler.

### Rendering rows

The module exports the two view classes and nothing else. Everything needed to render a row arrives through the `options` argument of `elementForItem`, so there is nothing to import and nothing to keep in sync.

#### Highlighting the query

`options.highlight` wraps the matched characters in `span.character-match`. With one argument it uses the item's own match indices:

```js
elementForItem: (item, { filterKey, highlight }) => {
  const li = document.createElement("li");
  li.appendChild(highlight(filterKey));
  return li;
};
```

Pass indices explicitly when the text you render is not the filter key — for example when a row prefixes the matched text and the offsets have to shift:

```js
elementForItem: (item, { matchIndices, highlight }) => {
  const li = document.createElement("li");
  li.appendChild(
    highlight(
      item.name,
      matchIndices.map((i) => i - offset),
    ),
  );
  return li;
};
```

`matchIndices` is a lazy getter, and `highlight` only reads it when called without indices — a row that supplies its own never pays for a fuzzy match.

#### Two-line rows

Return a descriptor object instead of an element and the row is built for you. The `two-lines` class is applied only when there is a secondary line, so the same callback can emit both one- and two-line rows:

```js
elementForItem: (item, { filterKey, highlight }) => ({
  primary: highlight(filterKey),
  secondary: item.description,
  icon: ["icon-file-text"],
});
```

`primary` and `secondary` take a string or a DOM node. `className` adds class names to the item itself, and `trailing` fills a right-hand block on the primary line. Trailing entries are DOM nodes, `{text, className}` descriptors, or falsy values that are skipped, so conditional content stays inline:

```js
elementForItem: (item, { filterKey, highlight }) => ({
  className: "my-package-item",
  primary: highlight(filterKey),
  secondary: item.path,
  trailing: [
    item.count > 0 && { text: `+${item.count}`, className: "status-added" },
    { text: item.branch, className: "badge badge-info" },
  ],
});
```

`didRender(element)` is called with the finished `<li>`, for decoration the descriptor cannot express — applying an icon, setting a dataset key. It keeps the markup owned by the component while the caller still reaches the result:

```js
elementForItem: (item, { highlight }) => ({
  primary: highlight(item.path),
  didRender: (li) => lumine.icons.applyTo(li.firstChild, { path: item.path }),
});
```

## Example

```js
const { SelectListView } = require("@lumine-code/select-list");
const fs = require("fs");
const path = require("path");

class MyFileList {
  constructor() {
    this.selectList = new SelectListView({
      className: "my-package my-file-list",
      items: [],
      filterKeyForItem: (item) => item.name,
      emptyMessage: "No files found",
      willShow: () => {
        this.loadFiles();
      },
      elementForItem: (item, { filterKey, highlight }) => {
        const li = document.createElement("li");
        li.appendChild(highlight(filterKey));
        return li;
      },
      didConfirmSelection: (item) => {
        lumine.workspace.open(item.path);
        this.selectList.hide();
      },
      didCancelSelection: () => {
        this.selectList.hide();
      },
    });
  }

  toggle() {
    this.selectList.toggle();
  }

  destroy() {
    this.selectList.destroy();
  }
}
```

## InputDialogView

`InputDialogView` is the base class of `SelectListView`. It is a modal panel with a mini query editor and no list semantics — use it for dialogs where the query is the value (prompts, save dialogs) and host any extra DOM through `headerElement`, `contentElement`, or `checkboxes`. Its root element carries the `input-dialog` class instead of `select-list`.

### Constructor props

- `className: String`: CSS class name(s) to add to the dialog element.
- `placeholderText: String`: placeholder text for the query editor.
- `headerElement: HTMLElement`: a caller-owned DOM element rendered **above** the query editor (e.g. an icon prompt label).
- `contentElement: HTMLElement`: a caller-owned DOM element rendered **below** the messages.
- `checkboxes: [{ label, config?, checked?, onChange? }]`: a row of checkboxes rendered below the messages. A checkbox with a `config` key is bound to `lumine.config`: it reflects the current value, writes on toggle (propagating to every renderer), and re-renders on external change. Without `config` it keeps local state seeded from `checked`. `onChange(checked)` is called on every toggle. Toggling returns focus to the query editor so Enter still confirms.
- `query: String` / `selectQuery: Boolean`: control the query editor content and selection via `update`.
- `preserveQuery: Boolean`: as on `SelectListView` — see [The query](#the-query).
- `filterQuery: (query: String) -> String`: a transformation applied to the query before it is passed to `didChangeQuery`.
- `emptyMessage` is not supported (there is no list); `infoMessage`, `loadingMessage`, `loadingBadge`, and `status` behave as on `SelectListView` — see [The message line](#the-message-line).
- `panelItem`, `skipCommandsRegistration`, `crumb`: as on `SelectListView`.

Interactive controls anywhere in the dialog (checkboxes, buttons, links, inputs inside `contentElement`) receive focus and clicks normally; clicking non-interactive chrome keeps focus in the query editor.

### Callbacks

- `didChangeQuery: (query: String) -> Void`: called when the query changes.
- `didConfirm: (query: String) -> Void`: called on `core:confirm` with the raw query text.
- `didCancel: () -> Void`: called on `core:cancel` or when focus leaves the dialog.
- `willShow: () -> Void`: called whenever the panel becomes visible, whoever shows it.

### Methods

Panel and query management match `SelectListView`: `show(options?)` (including the `{crumb}` modal-flow form), `hide()`, `toggle()`, `isVisible()`, `getPanel()`, `focus()`, `reset()`, `destroy()`, `update(props)`, `getQuery()`, `getFilterQuery()`, `setQueryFromSelection()`, plus `confirm()` and `cancel()` to trigger the callbacks programmatically. `refs.queryEditor` exposes the underlying `TextEditor`.

### Dialog example

```js
const { InputDialogView } = require("@lumine-code/select-list");

class NameDialog {
  constructor() {
    this.body = document.createElement("div");
    this.body.classList.add("my-package-dialog-body");

    this.dialog = new InputDialogView({
      className: "my-package name-dialog",
      contentElement: this.body,
      placeholderText: "New name",
      didConfirm: (name) => this.confirm(name),
      didCancel: () => this.dialog.hide(),
    });
  }

  confirm(name) {
    if (!name.trim()) {
      // Cleared for you on the next keystroke.
      this.dialog.update({ status: { type: "error", message: "Enter a name." } });
      return;
    }
    this.onConfirm?.(name.trim());
    this.dialog.hide();
  }
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
