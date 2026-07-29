# select-list

Provides a fuzzy-searchable select-list and modal panel component.

This CommonJS [etch component](https://github.com/lumine-code/etch) provides keyboard and mouse navigation with built-in panel management. It is derived from [atom-select-list](https://github.com/atom/atom-select-list) and is maintained for Lumine's editor runtime.

## Features

- **Fuzzy filtering**: Multiple algorithms including `command-t` for file paths.
- **Match highlighting**: A `highlight` function handed to every row renderer.
- **Panel management**: Show/hide/toggle with focus restoration.
- **Lazy match indices**: Match positions computed only when accessed.
- **Diacritics support**: Accent-insensitive matching option.
- **Help mode**: Toggle help content in the panel.
- **Dialog base**: `InputDialogView` exposes the modal panel, query editor, and focus behavior for dialogs that are not lists.

## Installation

```sh
npm install @lumine-code/select-list
```

Inside Lumine there is nothing to install: the editor ships this component and
hands it out through `atom.workspace.buildSelectList(props)` and
`atom.workspace.buildInputDialog(props)`. A package should use those rather than
depending on this module directly.

## Upgrading to 4.0.0

The module now exports the two view classes and nothing else. The standalone
helpers — `highlightMatches`, `createTwoLineItem`, `createTrailingBlock`,
`getMatchIndices` and `removeDiacritics` — are gone from the public surface.

- `highlightMatches(text, matchIndices)` → `highlight(text)` from the
  `elementForItem` options. Pass indices as a second argument when they are not
  the item's own.
- `createTwoLineItem({...})` → return that same object from `elementForItem`
  instead of an element.
- `removeDiacritics(str)` → `atom.tools.removeDiacritics(str)`.
- `getMatchIndices(text, query)` → `options.matchIndices` inside
  `elementForItem`, or `atom.tools.fuzzyMatcher` directly outside one.

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
- `maxResults: Number`: the number of maximum items that are shown.
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
- `emptyMessage: String`: a string shown when the list is empty.
- `errorMessage: String`: a string that needs to be set when you want to notify the user that an error occurred.
- `infoMessage: String`: a string that needs to be set when you want to provide some information to the user.
- `helpMessage: String`: HTML content to display when help is toggled.
- `helpMarkdown: String`: markdown content to display when help is toggled. Rendered using Lumine's built-in markdown renderer.
- `loadingMessage: String`: a string that needs to be set when you are loading items in the background.
- `loadingSpinner: Boolean`: show spinner next to loading message.
- `loadingBadge: String/Number`: a string or number that needs to be set when the progress status changes.
- `itemsClassList: [String]`: an array of strings that will be added as class names to the items element.
- `contentElement: HTMLElement`: a caller-owned DOM element rendered below the list and messages. Interactive elements inside it (`input`, `textarea`, `select`, `button`, `a[href]`, `[tabindex]`, `atom-text-editor`) can receive focus and clicks; anywhere else keeps focus in the query editor. Hidden while help is displayed.
- `initialSelectionIndex: Number`: the index of the item to initially select; defaults to `0`.
- `initiallyVisibleItemCount: Number`: render only the first N items eagerly; items beyond that count get `visible: false` in `elementForItem` and are re-rendered when scrolled into view (via `IntersectionObserver`). Useful for very long lists with expensive item rendering. Constructor-only — cannot be changed via `update`.
- `placeholderText: String`: placeholder text to display in the query editor when empty.
- `panelItem: Object`: the item passed to `atom.workspace.addModalPanel` (defaults to the select list itself). Useful when a wrapper view should be exposed as `panel.item`; the object must have an `element` property. Constructor-only.
- `skipCommandsRegistration: Boolean`: when `true`, skips registering default keyboard commands.
- `headerElement: HTMLElement` and `checkboxes: [Object]` are inherited from `InputDialogView` and work here too; see [InputDialogView](#inputdialogview) for their shape.

### Registered commands

By default, the component registers these commands on its element:

- `core:move-up` / `core:move-down`: Navigate items
- `core:move-to-top` / `core:move-to-bottom`: Jump to first/last item
- `core:confirm`: Confirm selection
- `core:cancel`: Cancel selection
- `select-list:help`: Toggle help message visibility (requires `helpMessage` or `helpMarkdown`)

The `` ` `` key in the query editor also toggles help, but only when `helpMessage` or `helpMarkdown` is set; otherwise it types normally.

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
- `isHelpMode()`: Returns `true` if help is currently displayed.
- `toggleHelp()`: Toggles help message visibility. Only works if `helpMessage` is set.
- `hideHelp()`: Hides help message if currently shown.

#### Item actions

Defined on `InputDialogView`, so every select list *and* every dialog offers them.

- `showItemActions()`: Shows the item-actions list as a modal-flow step (crumb "Actions") — the commands the dialog itself contributes, in the package's own namespace (`fuzzy-files:open`), with the label, description, and keybindings each carries in the command registry and keymaps, rendered command-palette style. Bound to F12 as `select-list:actions`; F12 pressed in the actions list itself goes back, so the key toggles. Confirming a row — or pressing an action's own keybinding right in the actions list, which wears the master's classes so the package keymap applies there untouched — returns to the master first and then dispatches the command, exactly as if the keystroke was pressed there. A package only has to register its commands with a `description` for the rows to explain themselves; nothing is declared twice.
- `itemActions()`: Returns the derived action descriptors (`{name, description, command, keystrokes}`).

#### Other methods

- `focus()`: Focuses the query editor.
- `reset()`: Clears the query editor text.
- `destroy()`: Disposes of the component and cleans up resources.
- `update(props)`: Updates the component with new props.
- `getQuery()`: Returns the current query string.
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

Sets the etch scheduler used by the component. The component initializes this to `atom.views` automatically when possible.

#### `SelectListView.getScheduler()`

Returns the current etch scheduler.

#### `SelectListView.initializeScheduler()`

Initializes the etch scheduler from `atom.views` if it has not already been configured.

### Rendering rows

The module exports the two view classes and nothing else. Everything needed to
render a row arrives through the `options` argument of `elementForItem`, so there
is nothing to import and nothing to keep in sync.

#### Highlighting the query

`options.highlight` wraps the matched characters in `span.character-match`. With
one argument it uses the item's own match indices:

```js
elementForItem: (item, { filterKey, highlight }) => {
  const li = document.createElement("li");
  li.appendChild(highlight(filterKey));
  return li;
};
```

Pass indices explicitly when the text you render is not the filter key — for
example when a row prefixes the matched text and the offsets have to shift:

```js
elementForItem: (item, { matchIndices, highlight }) => {
  const li = document.createElement("li");
  li.appendChild(highlight(item.name, matchIndices.map((i) => i - offset)));
  return li;
};
```

`matchIndices` is a lazy getter, and `highlight` only reads it when called
without indices — a row that supplies its own never pays for a fuzzy match.

#### Two-line rows

Return a descriptor object instead of an element and the row is built for you.
The `two-lines` class is applied only when there is a secondary line, so the same
callback can emit both one- and two-line rows:

```js
elementForItem: (item, { filterKey, highlight }) => ({
  primary: highlight(filterKey),
  secondary: item.description,
  icon: ["icon-file-text"],
});
```

`primary` and `secondary` take a string or a DOM node. `className` adds class
names to the item itself, and `trailing` fills a right-hand block on the primary
line. Trailing entries are DOM nodes, `{text, className}` descriptors, or falsy
values that are skipped, so conditional content stays inline:

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

`didRender(element)` is called with the finished `<li>`, for decoration the
descriptor cannot express — applying an icon, setting a dataset key. It keeps the
markup owned by the component while the caller still reaches the result:

```js
elementForItem: (item, { highlight }) => ({
  primary: highlight(item.path),
  didRender: (li) => atom.icons.applyTo(li.firstChild, { path: item.path }),
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
        atom.workspace.open(item.path);
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
- `checkboxes: [{ label, config?, checked?, onChange? }]`: a row of checkboxes rendered below the messages. A checkbox with a `config` key is bound to `atom.config`: it reflects the current value, writes on toggle (propagating to every renderer), and re-renders on external change. Without `config` it keeps local state seeded from `checked`. `onChange(checked)` is called on every toggle. Toggling returns focus to the query editor so Enter still confirms.
- `query: String` / `selectQuery: Boolean`: control the query editor content and selection via `update`.
- `filterQuery: (query: String) -> String`: a transformation applied to the query before it is passed to `didChangeQuery`.
- `emptyMessage` is not supported (there is no list); `infoMessage`, `errorMessage`, `loadingMessage`, `loadingSpinner`, `loadingBadge`, `helpMessage`, and `helpMarkdown` behave as on `SelectListView`.
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
      this.dialog.update({ errorMessage: "Enter a name." });
      return;
    }
    this.onConfirm?.(name.trim());
    this.dialog.hide();
  }
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
