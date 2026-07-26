"use strict";

const { Disposable } = require("atom");
const etch = require("@lumine-code/etch");
const Diacritics = require("diacritic");
const { InputDialogView } = require("./input-dialog");
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
      atom.ui.fuzzyMatcher.setCandidates(this.filterMatcher, this.candidates);
    } else {
      this.filterMatcher = atom.ui.fuzzyMatcher.setCandidates(this.candidates, {
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
      this.indexMatcher = atom.ui.fuzzyMatcher.setCandidates([filterKey], {
        ignoreDiacritics: !!this.props.removeDiacritics,
      });
    } else {
      atom.ui.fuzzyMatcher.setCandidates(this.indexMatcher, [filterKey]);
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

/**
 * Computes fuzzy match indices for a text against a query.
 * @param {string} text - The text to match against
 * @param {string} query - The query to match
 * @param {Object} [options] - Optional settings
 * @param {boolean} [options.removeDiacritics=false] - Match accent-insensitively.
 *   Folding is done natively; the returned indices refer to the original `text`.
 * @returns {number[]|null} Array of character indices that matched, or null if no match
 */
function getMatchIndices(text, query, options = {}) {
  if (!text || !query) return null;

  const result = atom.ui.fuzzyMatcher.match(text, query, {
    ignoreDiacritics: !!options.removeDiacritics,
    recordMatchIndexes: true,
  });

  return result?.matchIndexes ?? null;
}

function highlightMatches(text, matchIndices, options = {}) {
  const { className = "character-match" } = options;
  const fragment = document.createDocumentFragment();

  if (!matchIndices || matchIndices.length === 0) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  // Filter out invalid indices (negative or out of range)
  const validIndices = matchIndices.filter((i) => i >= 0 && i < text.length);

  if (validIndices.length === 0) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  let lastIndex = 0;
  let matchChars = "";

  for (const index of validIndices) {
    if (index > lastIndex) {
      if (matchChars) {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = matchChars;
        fragment.appendChild(span);
        matchChars = "";
      }
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, index)));
    }
    matchChars += text[index];
    lastIndex = index + 1;
  }

  if (matchChars) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = matchChars;
    fragment.appendChild(span);
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  return fragment;
}

/**
 * Builds the right-hand block of a primary line. Entries may be DOM nodes,
 * `{text, className}` descriptors, or falsy so callers can inline conditionals.
 * @param {Node|Array} trailing - A node, or a list of nodes and descriptors
 * @returns {HTMLSpanElement|null} The container, or null when there is nothing to show
 */
function createTrailingBlock(trailing) {
  const entries = (Array.isArray(trailing) ? trailing : [trailing]).filter(Boolean);
  if (entries.length === 0) return null;

  const block = document.createElement("span");
  block.classList.add("trailing-block");
  for (const entry of entries) {
    // Duck-typed rather than `instanceof Node` so the helper also runs outside a
    // browser realm, where that global does not exist.
    if (typeof entry.nodeType === "number") {
      block.appendChild(entry);
      continue;
    }
    const span = document.createElement("span");
    if (entry.className) {
      span.classList.add(...String(entry.className).split(/\s+/).filter(Boolean));
    }
    span.textContent = entry.text ?? "";
    block.appendChild(span);
  }
  return block;
}

/**
 * Creates a list item element with a primary line and an optional secondary
 * line. The `two-lines` class is only applied when there is a secondary line,
 * so the same helper builds both one- and two-line rows.
 * @param {Object} options - Configuration options
 * @param {string|Node} options.primary - Primary line content (text or DOM node)
 * @param {string|Node} [options.secondary] - Secondary line content (optional)
 * @param {string[]} [options.icon] - Icon class names to add to primary line
 * @param {string|string[]} [options.className] - Extra class names for the item
 * @param {Node|Array} [options.trailing] - Right-hand content for the primary line
 * @returns {HTMLLIElement} The created list item element
 */
function createTwoLineItem({ primary, secondary, icon, className, trailing }) {
  const li = document.createElement("li");
  const hasSecondary = secondary !== undefined && secondary !== null;
  if (hasSecondary) {
    li.classList.add("two-lines");
  }
  if (className) {
    const names = Array.isArray(className) ? className : String(className).split(/\s+/);
    li.classList.add(...names.filter(Boolean));
  }

  const priLine = document.createElement("div");
  priLine.classList.add("primary-line");
  if (icon && icon.length > 0) {
    priLine.classList.add("icon", ...icon);
  }

  const wrapper = document.createElement("span");
  wrapper.classList.add("primary-text");
  if (typeof primary === "string") {
    wrapper.textContent = primary;
  } else if (primary) {
    wrapper.appendChild(primary);
  }
  priLine.appendChild(wrapper);

  const trailingBlock = trailing ? createTrailingBlock(trailing) : null;
  if (trailingBlock) {
    priLine.appendChild(trailingBlock);
  }
  li.appendChild(priLine);

  if (hasSecondary) {
    const secLine = document.createElement("div");
    secLine.classList.add("secondary-line");
    if (typeof secondary === "string") {
      secLine.textContent = secondary;
    } else {
      secLine.appendChild(secondary);
    }
    li.appendChild(secLine);
  }

  return li;
}

module.exports.SelectListView = SelectListView;
module.exports.InputDialogView = InputDialogView;
module.exports.removeDiacritics = Diacritics.clean;
module.exports.getMatchIndices = getMatchIndices;
module.exports.highlightMatches = highlightMatches;
module.exports.createTwoLineItem = createTwoLineItem;
module.exports.createTrailingBlock = createTrailingBlock;
