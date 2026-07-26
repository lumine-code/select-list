# select-list

Provides a fuzzy-searchable select-list and modal panel component.

This CommonJS [etch component](https://github.com/lumine-code/etch) provides keyboard and mouse navigation with built-in panel management. It is derived from [atom-select-list](https://github.com/atom/atom-select-list) and is maintained for Lumine's editor runtime.

## Features

- **Fuzzy filtering**: Multiple algorithms including `command-t` for file paths.
- **Match highlighting**: Built-in helpers for displaying match positions.
- **Panel management**: Show/hide/toggle with focus restoration.
- **Lazy match indices**: Match positions computed only when accessed.
- **Diacritics support**: Accent-insensitive matching option.
- **Help mode**: Toggle help content in the panel.
- **Dialog base**: `InputDialogView` exposes the modal panel, query editor, and focus behavior for dialogs that are not lists.

## Installation

```sh
npm install @lumine-code/select-list
```

## API

### Constructor props

When creating a new instance of a select list, or when calling `update` on an existing one, you can supply a JavaScript object that can contain any of the following properties:

#### Required

- `elementForItem: (item: Object, options: Object) -> HTMLElement`: a function that is called whenever an item needs to be displayed.
  - `options: Object`:
    - `selected: Boolean`: indicating whether item is selected or not.
    - `index: Number`: item's index.
    - `filterKey: String|null`: the text that was matched against (from `filterKeyForItem` or item itself).
    - `matchIndices: [Number]|null`: lazy getter - character indices in `filterKey` that matched the query. Only computed when accessed.
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
- `query: String`: a string that will replace the contents of the query editor.
- `selectQuery: Boolean`: a boolean indicating whether the query text should be selected or not.
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
- `willShow: () -> Void`: called when transitioning from hidden to visible, useful for data preparation.

### Instance properties

- `processedQuery: String`: The cached result of `getFilterQuery()`, updated after each query change. Useful in `elementForItem` to avoid calling `getFilterQuery()` multiple times.
- `selectionIndex: Number|undefined`: The index of the currently selected item, or `undefined` if nothing is selected.
- `refs.queryEditor`: The underlying TextEditor component for the query input.

### Instance methods

#### Panel management

- `show()`: Shows the select list as a modal panel and focuses the query editor. Calls `willShow` callback if provided.
- `hide()`: Hides the panel and restores focus to the previously focused element.
- `toggle()`: Toggles the visibility of the panel.
- `isVisible()`: Returns `true` if the panel is currently visible.
- `getPanel()`: Returns the modal panel hosting the select list, creating it hidden on first access.
- `isHelpMode()`: Returns `true` if help is currently displayed.
- `toggleHelp()`: Toggles help message visibility. Only works if `helpMessage` is set.
- `hideHelp()`: Hides help message if currently shown.

#### Other methods

- `focus()`: Focuses the query editor.
- `reset()`: Clears the query editor text.
- `destroy()`: Disposes of the component and cleans up resources.
- `update(props)`: Updates the component with new props.
- `getQuery()`: Returns the current query string.
- `getFilterKey(item)`: Returns the filter key string for an item (from cache, `filterKeyForItem`, or item itself).
- `getMatchIndices(item, filterKey?)`: Returns match indices for an item, computing lazily if needed. Prefer using `options.matchIndices` in `elementForItem` instead.
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

### Helper exports

The package exports these standalone helpers alongside the classes; destructure them from the module.

#### `getMatchIndices(text, query, options)`

Computes fuzzy match indices for a text against a query. Useful outside of `elementForItem` context.

```js
const { getMatchIndices } = require("@lumine-code/select-list");

const indices = getMatchIndices("MyComponent.js", "mcjs");
// => [0, 2, 11, 12] or null if no match

// With diacritics removal
const indices = getMatchIndices("café", "cafe", { removeDiacritics: true });
// => [0, 1, 2, 3]
```

#### `highlightMatches(text, matchIndices, options)`

Creates a DocumentFragment with highlighted match characters.

```js
const { highlightMatches } = require("@lumine-code/select-list");

// In elementForItem, use options.matchIndices (lazy getter):
elementForItem: (item, { filterKey, matchIndices }) => {
  const li = document.createElement("li");
  li.appendChild(highlightMatches(filterKey, matchIndices));
  return li;
};
```

#### `removeDiacritics(str)`

Removes diacritical marks (accents) from a string.

```js
removeDiacritics("café"); // => 'cafe'
```

#### `createTwoLineItem(options)`

Creates a list item element with a primary line and an optional secondary line.
The `two-lines` class is applied only when there is a secondary line, so the same
helper builds both one- and two-line rows.

```js
elementForItem: (item, { filterKey, matchIndices }) => {
  return createTwoLineItem({
    primary: highlightMatches(filterKey, matchIndices),
    secondary: item.description,
    icon: ["icon-file-text"],
  });
};
```

`className` adds class names to the item itself, and `trailing` fills a right-hand
block on the primary line. Trailing entries are DOM nodes, `{text, className}`
descriptors, or falsy values that are skipped, so conditional content stays inline:

```js
elementForItem: (item, { filterKey, matchIndices }) => {
  return createTwoLineItem({
    className: "my-package-item",
    primary: highlightMatches(filterKey, matchIndices),
    secondary: item.path,
    trailing: [
      item.count > 0 && { text: `+${item.count}`, className: "status-added" },
      { text: item.branch, className: "badge badge-info" },
    ],
  });
};
```

#### `createTrailingBlock(trailing)`

Builds the `trailing` container on its own, for callers assembling an item element
by hand. Returns `null` when there is nothing to show.

## Example

```js
const { SelectListView, highlightMatches } = require("@lumine-code/select-list");
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
      elementForItem: (item, { index, filterKey, matchIndices }) => {
        const li = document.createElement("li");
        li.appendChild(highlightMatches(filterKey, matchIndices));
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
- `panelItem`, `skipCommandsRegistration`: as on `SelectListView`.

Interactive controls anywhere in the dialog (checkboxes, buttons, links, inputs inside `contentElement`) receive focus and clicks normally; clicking non-interactive chrome keeps focus in the query editor.

### Callbacks

- `didChangeQuery: (query: String) -> Void`: called when the query changes.
- `didConfirm: (query: String) -> Void`: called on `core:confirm` with the raw query text.
- `didCancel: () -> Void`: called on `core:cancel` or when focus leaves the dialog.
- `willShow: () -> Void`: called when transitioning from hidden to visible.

### Methods

Panel and query management match `SelectListView`: `show()`, `hide()`, `toggle()`, `isVisible()`, `getPanel()`, `focus()`, `reset()`, `destroy()`, `update(props)`, `getQuery()`, `getFilterQuery()`, `setQueryFromSelection()`, plus `confirm()` and `cancel()` to trigger the callbacks programmatically. `refs.queryEditor` exposes the underlying `TextEditor`.

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
