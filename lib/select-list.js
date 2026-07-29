"use strict";

const { Disposable, CompositeDisposable } = require("atom");
const { humanizeKeystroke } = require("@lumine-code/underscore-plus");
const etch = require("@lumine-code/etch");
const { InputDialogView } = require("./input-dialog");
const { highlightMatches, createTwoLineItem } = require("./helpers");
const $ = etch.dom;

// The dialog's own chrome commands never appear in the item-actions list.
const UNLISTED_ACTIONS = new Set(["select-list:help", "select-list:actions"]);

/**
 * Fuzzy-searchable select list. Extends InputDialogView — which owns the
 * modal panel, query editor, focus handling, and confirm/cancel commands —
 * with items, filtering, selection, and list rendering.
 */
class SelectListView extends InputDialogView {
  initializeState() {
    if (!Object.prototype.hasOwnProperty.call(this.props, "initialSelectionIndex")) {
      this.props.initialSelectionIndex = 0;
    }
    if (this.props.initiallyVisibleItemCount) {
      this.initializeVisibilityObserver();
    }
    if (!this.props.items) {
      this.props.items = [];
    } else {
      this.buildCandidates();
      this.filterItems(false);
    }
  }

  rootClasses() {
    return ["select-list"];
  }

  /**
   * Creates the IntersectionObserver used when `initiallyVisibleItemCount` is
   * set. Items beyond that count render with `visible: false` until they are
   * scrolled into view, at which point they re-render with `visible: true`.
   */
  initializeVisibilityObserver() {
    this.visibilityObserver = new IntersectionObserver((changes) => {
      for (const change of changes) {
        if (change.intersectionRatio > 0) {
          const element = change.target;
          this.visibilityObserver.unobserve(element);
          const index = Array.from(this.refs.items.children).indexOf(element);
          if (index >= 0) {
            this.renderItemAtIndex(index);
          }
        }
      }
    });
  }

  /**
   * Destroys the select list and cleans up resources.
   * @returns {Promise} Resolves when destruction is complete
   */
  destroy() {
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
    }
    if (this.itemActionsDisposables) {
      this.itemActionsDisposables.dispose();
      this.itemActionsDisposables = null;
    }
    if (this.itemActionsList) {
      this.itemActionsList.destroy();
      this.itemActionsList = null;
    }
    this.filterMatcher = null;
    this.indexMatcher = null;
    this.cachedCandidates = null;
    this.cachedItemByIndex = null;
    return super.destroy();
  }

  /**
   * The item actions this list offers: the commands the dialog itself
   * contributes — those reachable from its query editor but not from the
   * panel's host — each with the label, description, and keybindings it
   * carries in the registry, the same sources the command palette reads.
   * Packages register their actions in their own namespace
   * (`fuzzy-files:open`); the dialog's chrome (`core:*`, `select-list:*`
   * built-ins) stays out. An `actionsFilter(descriptor)` prop replaces the
   * default exclusions.
   * @returns {Array} Action descriptors: {name, description, command, keystrokes}
   */
  itemActions() {
    // Anchor on the dialog root, not the query editor: from the editor the
    // difference would also sweep in every selector-based editor command.
    // From the root it holds exactly what the dialog contributes — packages
    // register their actions inline on this element.
    const host = this.getPanel().getElement().parentNode ?? atom.workspace.getElement();
    const above = new Set(
      atom.commands.findCommands({ target: host }).map((descriptor) => descriptor.name),
    );
    const filter =
      this.props.actionsFilter ??
      ((descriptor) =>
        !descriptor.name.startsWith("core:") && !UNLISTED_ACTIONS.has(descriptor.name));
    // Keybindings resolve against the query editor, where list keymaps point.
    const bindingTarget = this.refs.queryEditor.element;
    return atom.commands
      .findCommands({ target: this.element })
      .filter((descriptor) => !above.has(descriptor.name))
      .filter(filter)
      .map((descriptor) => ({
        // In a list that belongs to one package, the namespace is noise.
        name: descriptor.displayName.replace(/^[^:]+:\s*/, ""),
        description: descriptor.description,
        command: descriptor.name,
        keystrokes: atom.keymaps
          .findKeyBindings({ command: descriptor.name, target: bindingTarget })
          .map((binding) => binding.keystrokes),
      }));
  }

  /**
   * Shows the item-actions list — every action this list offers, with its
   * keybinding — as a step of the modal flow. Bound to Shift-Enter as
   * `select-list:actions`. Confirming an action (or pressing its keybinding
   * right in the actions list) returns here first and then runs the command
   * against the selection, exactly as if it was pressed in this list.
   */
  async showItemActions() {
    if (this.props.skipItemActions) return;
    const actions = this.itemActions();
    if (actions.length === 0) return;

    if (!this.itemActionsList) {
      this.itemActionsList = new SelectListView({
        // The actions list wears the master's classes, so the package's own
        // keymap applies inside it untouched — an action keystroke resolves
        // there exactly as it does in the master. Packages bind actions in
        // their own namespace and leave the chrome keys (enter, escape,
        // navigation, F12) alone, so the base select-list bindings keep
        // working here.
        className: ["select-list-actions", this.props.className].filter(Boolean).join(" "),
        // An actions list of an actions list would only find the forwarders.
        skipItemActions: true,
        items: [],
        filterKeyForItem: (item) => `${item.name} ${item.description ?? ""}`,
        elementForItem: (item, { highlight }) => ({
          primary: highlight(item.name),
          secondary: item.description,
          // Rendered the way the command palette writes keystrokes
          // (Alt+Enter); the raw form stays on the item for dispatching.
          trailing: item.keystrokes.map((keystrokes) => ({
            text: humanizeKeystroke(keystrokes),
            className: "key-binding",
          })),
        }),
        didConfirmSelection: (item) => this.runItemAction(item.command),
        didCancelSelection: () => this.itemActionsList.hide(),
      });
    }

    // Command listeners live on the master's element, so a keystroke resolved
    // inside the actions list needs a forwarder to reach them. Disposed when
    // the actions list hides, so a stale action set never lingers.
    if (this.itemActionsDisposables) this.itemActionsDisposables.dispose();
    const forwarders = {};
    for (const action of actions) {
      forwarders[action.command] = (event) => {
        this.runItemAction(action.command);
        event.stopPropagation();
      };
    }
    this.itemActionsDisposables = new CompositeDisposable(
      atom.commands.add(this.itemActionsList.element, forwarders),
      this.itemActionsList.getPanel().onDidChangeVisible((visible) => {
        if (visible) return;
        this.itemActionsDisposables?.dispose();
        this.itemActionsDisposables = null;
      }),
    );

    const selected = this.getSelectedItem();
    this.itemActionsList.reset();
    await this.itemActionsList.update({
      items: actions,
      infoMessage: selected != null ? this.getFilterKey(selected) : null,
    });
    this.itemActionsList.show({ crumb: "Actions" });
  }

  /**
   * Runs an item action: returns to this list first — so the handler sees the
   * visible, focused list and its intact selection — then dispatches the
   * command on the query editor, exactly like the keystroke it stands for.
   * @param {string} command - The command name to dispatch
   */
  runItemAction(command) {
    if (!atom.workspace.popModal()) {
      // The trail is gone (the actions list was somehow orphaned); recover by
      // swapping the panels directly.
      this.itemActionsList.hide();
      this.show();
    }
    atom.commands.dispatch(this.refs.queryEditor.element, command);
  }

  commandsForElement() {
    return {
      ...super.commandsForElement(),
      "select-list:actions": (event) => {
        this.showItemActions();
        event.stopPropagation();
      },
      "core:move-up": (event) => {
        if (this.isHelpMode()) return;
        this.selectPrevious();
        event.stopPropagation();
      },
      "core:move-down": (event) => {
        if (this.isHelpMode()) return;
        this.selectNext();
        event.stopPropagation();
      },
      "core:move-to-top": (event) => {
        if (this.isHelpMode()) return;
        this.selectFirst();
        event.stopPropagation();
      },
      "core:move-to-bottom": (event) => {
        if (this.isHelpMode()) return;
        this.selectLast();
        event.stopPropagation();
      },
    };
  }

  confirm() {
    this.confirmSelection();
  }

  cancel() {
    this.cancelSelection();
  }

  updateProps(props) {
    let shouldBuildCandidates = false;
    let shouldFilterItems = false;

    // Props that require rebuilding candidates
    if ("items" in props) {
      this.props.items = props.items;
      shouldBuildCandidates = true;
    }

    if ("filterKeyForItem" in props) {
      this.props.filterKeyForItem = props.filterKeyForItem;
      shouldBuildCandidates = true;
    }

    if ("removeDiacritics" in props) {
      this.props.removeDiacritics = props.removeDiacritics;
      shouldBuildCandidates = true;
    }

    // Props that only require re-filtering
    if ("maxResults" in props) {
      this.props.maxResults = props.maxResults;
      shouldFilterItems = true;
    }

    if ("filter" in props) {
      this.props.filter = props.filter;
      shouldFilterItems = true;
    }

    if ("filterQuery" in props) {
      this.props.filterQuery = props.filterQuery;
      shouldFilterItems = true;
    }

    if ("filterScoreModifier" in props) {
      this.props.filterScoreModifier = props.filterScoreModifier;
      shouldFilterItems = true;
    }

    if ("algorithm" in props) {
      this.props.algorithm = props.algorithm;
      shouldFilterItems = true;
    }

    if ("numThreads" in props) {
      this.props.numThreads = props.numThreads;
      shouldFilterItems = true;
    }

    if ("maxGap" in props) {
      this.props.maxGap = props.maxGap;
      shouldFilterItems = true;
    }

    if ("order" in props) {
      this.props.order = props.order;
      shouldFilterItems = true;
    }

    if ("emptyMessage" in props) {
      this.props.emptyMessage = props.emptyMessage;
    }

    if ("itemsClassList" in props) {
      this.props.itemsClassList = props.itemsClassList;
    }

    if ("initialSelectionIndex" in props) {
      this.props.initialSelectionIndex = props.initialSelectionIndex;
    }

    super.updateProps(props);

    if (shouldBuildCandidates) {
      this.buildCandidates();
      this.filterItems();
    } else if (shouldFilterItems) {
      this.filterItems();
    }
  }

  renderBody() {
    return this.renderItems();
  }

  renderItems() {
    if (this.items && this.items.length > 0) {
      const className = ["list-group"].concat(this.props.itemsClassList || []).join(" ");

      if (this.visibilityObserver) {
        etch.getScheduler().updateDocument(() => {
          if (!this.refs.items) return;
          Array.from(this.refs.items.children)
            .slice(this.props.initiallyVisibleItemCount)
            .forEach((element) => this.visibilityObserver.observe(element));
        });
      }

      this.listItems = this.items.map((item, index) => {
        const selected = this.getSelectedItem() === item;
        const filterKey = this.getFilterKey(item);
        const visible =
          !this.visibilityObserver || index < this.props.initiallyVisibleItemCount;
        const opts = { selected, index, filterKey, visible };
        // Lazy getter - matchIndices only computed when accessed
        Object.defineProperty(opts, "matchIndices", {
          get: () => this.getMatchIndices(item, filterKey),
          enumerable: true,
        });
        opts.highlight = (text, indices = opts.matchIndices) =>
          highlightMatches(text, indices);
        return $(ListItemView, {
          element: this.resolveElement(item, opts),
          selected: selected,
          onclick: () => this.didClickItem(index),
          oncontextmenu: () => this.selectIndex(index),
        });
      });

      return $.ol({ className, ref: "items" }, ...this.listItems);
    } else if (!this.props.loadingMessage && this.props.emptyMessage) {
      return $.div({ ref: "emptyMessage", className: "empty-message" }, this.props.emptyMessage);
    } else {
      return "";
    }
  }

  didChangeQuery() {
    super.didChangeQuery();
    this.filterItems();
  }

  didClickItem(itemIndex) {
    this.selectIndex(itemIndex);
    this.confirmSelection();
  }

  /**
   * Filters items based on current query.
   * Called on query change (uses existing candidates).
   */
  filterItems(updateComponent) {
    this.listItems = null;
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
    }
    this.matchIndicesMap = new Map();
    this.filterKeyMap = new Map();

    const filterFn = this.props.filter || this.fuzzyFilter.bind(this);
    this.processedQuery = this.getFilterQuery();
    this.items = filterFn(this.props.items.slice(), this.processedQuery);
    if (this.props.order) {
      this.items.sort(this.props.order);
    }
    if (this.props.maxResults) {
      this.items = this.items.slice(0, this.props.maxResults);
    }

    this.selectIndex(this.props.initialSelectionIndex, updateComponent);
  }

  /**
   * Builds candidates array and initializes the matcher.
   * Called when items or filter settings change.
   */
  buildCandidates() {
    this.candidates = [];
    this.itemByIndex = [];
    for (const item of this.props.items) {
      // Keep the original (possibly accented) filter key; diacritic folding is
      // handled inside the native matcher via the `ignoreDiacritics` option so
      // that reported match indexes line up with the original text.
      const filterKey = this.props.filterKeyForItem ? this.props.filterKeyForItem(item) : item;
      this.candidates.push(filterKey);
      this.itemByIndex.push(item);
    }
    // When a custom `filter` is supplied, the built-in fuzzy matcher is never
    // used, so skip building it. This also avoids handing non-string filter
    // keys (e.g. object items without a `filterKeyForItem`) to the native
    // matcher, which requires strings.
    if (this.props.filter) {
      return;
    }
    if (this.filterMatcher) {
      atom.tools.fuzzyMatcher.setCandidates(this.filterMatcher, this.candidates);
    } else {
      this.filterMatcher = atom.tools.fuzzyMatcher.setCandidates(this.candidates, {
        ignoreDiacritics: !!this.props.removeDiacritics,
      });
    }
  }

  fuzzyFilter(items, query) {
    if (query.length === 0) {
      return items;
    }
    const matchOptions = {
      recordMatchIndexes: false,
    };
    if (this.props.algorithm) matchOptions.algorithm = this.props.algorithm;
    if (this.props.numThreads) matchOptions.numThreads = this.props.numThreads;
    if (this.props.maxGap !== undefined) matchOptions.maxGap = this.props.maxGap;
    if (!this.filterMatcher) return [];
    const results = this.filterMatcher.match(query, matchOptions);
    const modifyScore = this.props.filterScoreModifier;
    const scoredItems = [];
    for (const result of results) {
      const item = this.itemByIndex[result.id];
      let score = result.score;
      if (modifyScore) {
        score = modifyScore(score, item);
      }
      if (score > 0) {
        scoredItems.push({
          item,
          score,
          filterKey: this.candidates[result.id],
        });
      }
    }
    if (modifyScore) {
      scoredItems.sort((a, b) => b.score - a.score);
    }
    for (const { item, filterKey } of scoredItems) {
      this.filterKeyMap.set(item, filterKey);
    }
    return scoredItems.map((i) => i.item);
  }

  /**
   * Returns the filter key for an item.
   * @param {*} item - The item to get the filter key for
   * @returns {string|null} The filter key string, or null
   */
  getFilterKey(item) {
    // Check stored filterKey from fuzzyFilter
    let filterKey = this.filterKeyMap?.get(item);
    if (filterKey) return filterKey;

    // Compute from filterKeyForItem. The original (accented) key is returned;
    // the native matcher folds diacritics internally when enabled.
    if (this.props.filterKeyForItem) {
      return this.props.filterKeyForItem(item);
    }

    // Fall back to item itself if string
    return typeof item === "string" ? item : null;
  }

  /**
   * Returns the match indices for an item, computing lazily if needed.
   * Match indices indicate which characters in the filter key matched the query.
   * @param {*} item - The item to get match indices for
   * @param {string} [filterKey] - Optional filter key override. If not provided,
   *   uses the stored filterKey from fuzzyFilter or computes from filterKeyForItem.
   * @returns {number[]|null} Array of character indices that matched, or null
   */
  getMatchIndices(item, filterKey) {
    // Check cache first
    const cached = this.matchIndicesMap?.get(item);
    if (cached !== undefined) return cached;

    // Use provided filterKey or get from item
    if (!filterKey) {
      filterKey = this.getFilterKey(item);
    }

    if (!filterKey || !this.processedQuery) {
      return null;
    }

    // Use reusable matcher for index computation. It folds diacritics the same
    // way as the filter matcher so indexes map back to the original filterKey.
    if (!this.indexMatcher) {
      this.indexMatcher = atom.tools.fuzzyMatcher.setCandidates([filterKey], {
        ignoreDiacritics: !!this.props.removeDiacritics,
      });
    } else {
      atom.tools.fuzzyMatcher.setCandidates(this.indexMatcher, [filterKey]);
    }

    const indexMatchOptions = {
      maxResults: 1,
      recordMatchIndexes: true,
    };
    if (this.props.algorithm) indexMatchOptions.algorithm = this.props.algorithm;
    if (this.props.maxGap !== undefined) indexMatchOptions.maxGap = this.props.maxGap;

    const results = this.indexMatcher.match(this.processedQuery, indexMatchOptions);

    const indexes = results.length > 0 ? results[0].matchIndexes : null;
    this.matchIndicesMap?.set(item, indexes);
    return indexes;
  }

  getSelectedItem() {
    if (this.selectionIndex === undefined) return null;
    return this.items[this.selectionIndex];
  }

  /**
   * Resolves the element for an item.
   * If elementForItem returns an HTML element, uses it directly.
   * If it returns a descriptor object, builds the row from it and hands the
   * result to the descriptor's `didRender`, so a caller can decorate a row it
   * did not build — apply an icon, set a dataset key — without owning the markup.
   * @param {*} item - The item to get an element for
   * @param {Object} opts - Options passed to elementForItem
   * @returns {HTMLElement} The resolved element
   */
  resolveElement(item, opts) {
    const result = this.props.elementForItem(item, opts);
    if (result instanceof HTMLElement) {
      return result;
    }
    const element = createTwoLineItem(result);
    result.didRender?.(element);
    return element;
  }

  renderItemAtIndex(index) {
    if (!this.listItems || index < 0 || index >= this.listItems.length) return;
    const item = this.items[index];
    const selected = this.getSelectedItem() === item;
    const filterKey = this.getFilterKey(item);
    const opts = { selected, index, filterKey, visible: true };
    // Lazy getter - matchIndices only computed when accessed
    Object.defineProperty(opts, "matchIndices", {
      get: () => this.getMatchIndices(item, filterKey),
      enumerable: true,
    });
    opts.highlight = (text, indices = opts.matchIndices) =>
      highlightMatches(text, indices);
    const component = this.listItems[index].component;
    if (this.visibilityObserver) {
      this.visibilityObserver.unobserve(component.element);
    }
    component.update({
      element: this.resolveElement(item, opts),
      selected: selected,
      onclick: () => this.didClickItem(index),
      oncontextmenu: () => this.selectIndex(index),
    });
  }

  selectPrevious() {
    if (this.selectionIndex === undefined) return this.selectLast();
    return this.selectIndex(this.selectionIndex - 1);
  }

  selectNext() {
    if (this.selectionIndex === undefined) return this.selectFirst();
    return this.selectIndex(this.selectionIndex + 1);
  }

  selectFirst() {
    return this.selectIndex(0);
  }

  selectLast() {
    return this.selectIndex(this.items.length - 1);
  }

  selectNone() {
    return this.selectIndex(undefined);
  }

  selectIndex(index, updateComponent = true) {
    if (index >= this.items.length) {
      index = 0;
    } else if (index < 0) {
      index = this.items.length - 1;
    }

    const oldIndex = this.selectionIndex;

    this.selectionIndex = index;
    if (index !== undefined && this.props.didChangeSelection) {
      this.props.didChangeSelection(this.getSelectedItem());
    }

    if (updateComponent) {
      if (this.listItems) {
        if (oldIndex >= 0) this.renderItemAtIndex(oldIndex);
        if (index >= 0) this.renderItemAtIndex(index);
        return etch.getScheduler().getNextUpdatePromise();
      } else {
        return etch.update(this);
      }
    } else {
      return Promise.resolve();
    }
  }

  selectItem(item) {
    const index = this.items.indexOf(item);
    if (index === -1) {
      throw new Error("Cannot select the specified item because it does not exist.");
    } else {
      return this.selectIndex(index);
    }
  }

  /**
   * Confirms the current selection.
   * Calls didConfirmSelection with the selected item, or didConfirmEmptySelection if none.
   */
  confirmSelection() {
    const selectedItem = this.getSelectedItem();
    if (selectedItem != null) {
      if (this.props.didConfirmSelection) {
        this.props.didConfirmSelection(selectedItem);
      }
    } else {
      if (this.props.didConfirmEmptySelection) {
        this.props.didConfirmEmptySelection();
      }
    }
  }

  /**
   * Cancels the selection and calls the didCancelSelection callback if provided.
   */
  cancelSelection() {
    if (this.props.didCancelSelection) {
      this.props.didCancelSelection();
    }
  }
}

class ListItemView {
  constructor(props) {
    this.mouseDown = this.mouseDown.bind(this);
    this.mouseUp = this.mouseUp.bind(this);
    this.didClick = this.didClick.bind(this);
    this.didContextMenu = this.didContextMenu.bind(this);
    this.selected = props.selected;
    this.onclick = props.onclick;
    this.oncontextmenu = props.oncontextmenu;
    this.element = props.element;
    this.element.addEventListener("mousedown", this.mouseDown);
    this.element.addEventListener("mouseup", this.mouseUp);
    this.element.addEventListener("click", this.didClick);
    this.element.addEventListener("contextmenu", this.didContextMenu);
    if (this.selected) {
      this.element.classList.add("selected");
    }
    this.domEventsDisposable = new Disposable(() => {
      this.element.removeEventListener("mousedown", this.mouseDown);
      this.element.removeEventListener("mouseup", this.mouseUp);
      this.element.removeEventListener("click", this.didClick);
      this.element.removeEventListener("contextmenu", this.didContextMenu);
    });
    etch.getScheduler().updateDocument(this.scrollIntoViewIfNeeded.bind(this));
  }

  mouseDown(event) {
    event.preventDefault();
  }

  mouseUp(event) {
    event.preventDefault();
  }

  didClick(event) {
    event.preventDefault();
    this.onclick();
  }

  didContextMenu() {
    this.oncontextmenu();
  }

  destroy() {
    this.element.remove();
    this.domEventsDisposable.dispose();
  }

  update(props) {
    this.element.removeEventListener("mousedown", this.mouseDown);
    this.element.removeEventListener("mouseup", this.mouseUp);
    this.element.removeEventListener("click", this.didClick);
    this.element.removeEventListener("contextmenu", this.didContextMenu);

    if (this.element.parentNode) {
      this.element.parentNode.replaceChild(props.element, this.element);
    }
    this.element = props.element;
    this.element.addEventListener("mousedown", this.mouseDown);
    this.element.addEventListener("mouseup", this.mouseUp);
    this.element.addEventListener("click", this.didClick);
    this.element.addEventListener("contextmenu", this.didContextMenu);
    if (props.selected) {
      this.element.classList.add("selected");
    } else {
      this.element.classList.remove("selected");
    }

    this.selected = props.selected;
    this.onclick = props.onclick;
    this.oncontextmenu = props.oncontextmenu;
    etch.getScheduler().updateDocument(this.scrollIntoViewIfNeeded.bind(this));
  }

  scrollIntoViewIfNeeded() {
    if (this.selected) {
      this.element.scrollIntoViewIfNeeded(false);
    }
  }
}

// The public surface is the two view classes and nothing else. The render
// helpers in ./helpers are reached through a view: `highlight` on the
// `elementForItem` options, and a descriptor return from `elementForItem`.
module.exports.SelectListView = SelectListView;
module.exports.InputDialogView = InputDialogView;
