"use strict";

const { Disposable } = require("atom");
const etch = require("@lumine-code/etch");
const { InputDialogView } = require("./input-dialog");
const { highlightMatches, createTwoLineItem } = require("./helpers");
const $ = etch.dom;

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
    this.filterMatcher = null;
    this.indexMatcher = null;
    this.cachedCandidates = null;
    this.cachedItemByIndex = null;
    return super.destroy();
  }

  commandsForElement() {
    return {
      ...super.commandsForElement(),
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
   * If it returns an object, passes it to createTwoLineItem.
   * @param {*} item - The item to get an element for
   * @param {Object} opts - Options passed to elementForItem
   * @returns {HTMLElement} The resolved element
   */
  resolveElement(item, opts) {
    const result = this.props.elementForItem(item, opts);
    if (result instanceof HTMLElement) {
      return result;
    }
    return createTwoLineItem(result);
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
