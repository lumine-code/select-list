const { CompositeDisposable } = require("atom");
const { SelectListView } = require("../lib/select-list");
// Internal render helpers. They are deliberately absent from the package's
// public surface, so the specs reach them the same way the implementation does.
const {
  highlightMatches,
  getMatchIndices,
  createTwoLineItem,
  createTrailingBlock,
} = require("../lib/helpers");

describe("SelectListView", () => {
  let view;

  function textItemView(props = {}) {
    return new SelectListView({
      items: ["one", "two", "three"],
      elementForItem: (item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      },
      ...props,
    });
  }

  function listTexts() {
    return Array.from(view.element.querySelectorAll("li"), (li) => li.textContent);
  }

  async function nextUpdate() {
    await SelectListView.getScheduler().getNextUpdatePromise();
  }

  beforeEach(() => {
    jasmine.attachToDOM(atom.views.getView(atom.workspace));
  });

  afterEach(async () => {
    if (view) {
      await view.destroy();
      view = null;
    }
  });

  describe("rendering and filtering", () => {
    it("renders all items initially and filters them as the query changes", async () => {
      view = textItemView();
      expect(listTexts()).toEqual(["one", "two", "three"]);

      view.refs.queryEditor.setText("tw");
      await nextUpdate();
      expect(listTexts()).toEqual(["two"]);

      view.refs.queryEditor.setText("");
      await nextUpdate();
      expect(listTexts()).toEqual(["one", "two", "three"]);
    });

    it("filters via filterKeyForItem for object items", async () => {
      view = new SelectListView({
        items: [{ name: "alpha" }, { name: "beta" }],
        filterKeyForItem: (item) => item.name,
        elementForItem: (item) => {
          const li = document.createElement("li");
          li.textContent = item.name;
          return li;
        },
      });

      view.refs.queryEditor.setText("bet");
      await nextUpdate();
      expect(listTexts()).toEqual(["beta"]);
    });

    it("renders standalone separators before items selected by id", async () => {
      view = textItemView({ separatorIds: ["two"] });

      let separator = view.element.querySelector(".select-list-separator");
      expect(separator.tagName).toBe("LI");
      expect(separator.getAttribute("role")).toBe("separator");
      expect(separator.previousElementSibling.textContent).toBe("one");
      expect(separator.nextElementSibling.textContent).toBe("two");
      expect(view.items).toEqual(["one", "two", "three"]);

      await view.selectNext();
      expect(view.getSelectedItem()).toBe("two");
      expect(view.element.querySelector("li.selected").textContent).toBe("two");

      await view.update({ separatorIds: ["three"] });
      separator = view.element.querySelector(".select-list-separator");
      expect(separator.previousElementSibling.textContent).toBe("two");
      expect(separator.nextElementSibling.textContent).toBe("three");
    });

    it("supports custom item identifiers for separators", () => {
      const items = [{ name: "alpha" }, { name: "beta" }];
      view = new SelectListView({
        items,
        separatorIds: ["BETA"],
        idForItem: (item) => item.name.toUpperCase(),
        filterKeyForItem: (item) => item.name,
        elementForItem: (item) => ({ primary: item.name }),
      });

      const separator = view.element.querySelector(".select-list-separator");
      expect(separator.previousElementSibling.textContent).toBe("alpha");
      expect(separator.nextElementSibling.textContent).toBe("beta");
    });

    it("limits the rendered items to a maxResults batch behind the Show more row", () => {
      view = textItemView({ maxResults: 2 });
      expect(listTexts()).toEqual(["one", "two", "Show more…"]);
    });

    it("renders emptyMessage when no items match", async () => {
      view = textItemView({ emptyMessage: "nothing here" });
      view.refs.queryEditor.setText("zzz");
      await nextUpdate();
      expect(view.refs.emptyMessage.textContent).toBe("nothing here");
    });

    it("renders two-line items from {primary, secondary} descriptors", () => {
      view = new SelectListView({
        items: ["item"],
        elementForItem: (item) => ({ primary: item, secondary: "detail" }),
      });
      const li = view.element.querySelector("li");
      expect(li.classList.contains("two-lines")).toBe(true);
      expect(li.querySelector(".primary-line").textContent).toBe("item");
      expect(li.querySelector(".secondary-line").textContent).toBe("detail");
    });

    it("passes matchIndices aligned with the filter key to elementForItem", async () => {
      view = new SelectListView({
        items: ["abc", "xyz"],
        elementForItem: (item, { filterKey, matchIndices }) => {
          const li = document.createElement("li");
          li.appendChild(highlightMatches(filterKey, matchIndices));
          return li;
        },
      });

      view.refs.queryEditor.setText("ac");
      await nextUpdate();
      const matches = view.element.querySelectorAll(".character-match");
      expect(Array.from(matches, (m) => m.textContent)).toEqual(["a", "c"]);
    });

    it("hands a descriptor's didRender the finished element", async () => {
      const rendered = [];
      view = new SelectListView({
        items: ["one", "two"],
        elementForItem: (item) => ({
          primary: item,
          didRender: (li) => {
            li.dataset.item = item;
            rendered.push(li);
          },
        }),
      });

      await nextUpdate();
      expect(rendered.length).toBe(2);
      expect(rendered[0].tagName).toBe("LI");
      expect(
        Array.from(view.element.querySelectorAll("li"), (li) => li.dataset.item),
      ).toEqual(["one", "two"]);
    });

    it("passes a highlight function bound to the item's own match indices", async () => {
      view = new SelectListView({
        items: ["abc", "xyz"],
        elementForItem: (item, { filterKey, highlight }) => {
          const li = document.createElement("li");
          li.appendChild(highlight(filterKey));
          return li;
        },
      });

      view.refs.queryEditor.setText("ac");
      await nextUpdate();
      const matches = view.element.querySelectorAll(".character-match");
      expect(Array.from(matches, (m) => m.textContent)).toEqual(["a", "c"]);
    });

    it("lets highlight take explicit indices, for callers that shift offsets", async () => {
      view = new SelectListView({
        items: ["abc"],
        elementForItem: (item, { highlight }) => {
          const li = document.createElement("li");
          li.appendChild(highlight(`>${item}`, [1, 3]));
          return li;
        },
      });

      await nextUpdate();
      const matches = view.element.querySelectorAll(".character-match");
      expect(Array.from(matches, (m) => m.textContent)).toEqual(["a", "c"]);
    });

    it("does not compute match indices unless highlight is called without them", async () => {
      const getMatchIndicesSpy = spyOn(
        SelectListView.prototype,
        "getMatchIndices",
      ).andCallThrough();

      view = new SelectListView({
        items: ["abc"],
        elementForItem: (item, { highlight }) => {
          const li = document.createElement("li");
          li.appendChild(highlight(item, [0]));
          return li;
        },
      });

      await nextUpdate();
      expect(getMatchIndicesSpy).not.toHaveBeenCalled();
    });

    it("provides highlight on the re-render path as well", async () => {
      view = new SelectListView({
        // Forces the IntersectionObserver path, so re-rendering a row goes
        // through renderItemAtIndex rather than a full renderItems pass.
        initiallyVisibleItemCount: 1,
        items: ["abc", "abd"],
        elementForItem: (item, { highlight }) => {
          const li = document.createElement("li");
          li.appendChild(highlight(item));
          return li;
        },
      });

      view.refs.queryEditor.setText("ab");
      await nextUpdate();
      await view.selectIndex(1);
      const matches = view.element.querySelectorAll("li .character-match");
      expect(Array.from(matches, (m) => m.textContent)).toEqual(["ab", "ab"]);
    });
  });

  describe("selection", () => {
    it("wraps when navigating past the ends of the list", async () => {
      view = textItemView();
      expect(view.getSelectedItem()).toBe("one");

      await view.selectPrevious();
      expect(view.getSelectedItem()).toBe("three");

      await view.selectNext();
      expect(view.getSelectedItem()).toBe("one");

      await view.selectLast();
      expect(view.getSelectedItem()).toBe("three");

      await view.selectFirst();
      expect(view.getSelectedItem()).toBe("one");
    });

    it("starts empty and steps off both ends into the empty selection when allowed", async () => {
      view = textItemView({ allowEmptySelection: true });
      // The state has to be reachable to be useful, so the list starts in it.
      expect(view.getSelectedItem()).toBeNull();

      await view.selectNext();
      expect(view.getSelectedItem()).toBe("one");
      await view.selectNext();
      await view.selectNext();
      expect(view.getSelectedItem()).toBe("three");

      // Off the end, then back in at the far end.
      await view.selectNext();
      expect(view.getSelectedItem()).toBeNull();
      await view.selectNext();
      expect(view.getSelectedItem()).toBe("one");

      // Up is the same cycle in reverse.
      await view.selectPrevious();
      expect(view.getSelectedItem()).toBeNull();
      await view.selectPrevious();
      expect(view.getSelectedItem()).toBe("three");
    });

    it("still takes an explicit initial selection when empty selections are allowed", async () => {
      view = textItemView({ allowEmptySelection: true, initialSelectionIndex: 0 });
      expect(view.getSelectedItem()).toBe("one");

      await view.selectPrevious();
      expect(view.getSelectedItem()).toBeNull();
    });

    it("names an end rather than emptying the selection when asked for one", async () => {
      view = textItemView({ allowEmptySelection: true });

      await view.selectLast();
      expect(view.getSelectedItem()).toBe("three");
      await view.selectFirst();
      expect(view.getSelectedItem()).toBe("one");
    });

    it("marks the selected item's element and reports selection changes", async () => {
      const selections = [];
      view = textItemView({ didChangeSelection: (item) => selections.push(item) });

      await view.selectNext();
      expect(view.element.querySelector("li.selected").textContent).toBe("two");
      expect(selections[selections.length - 1]).toBe("two");
    });

    it("confirms the selected item and empty selections", async () => {
      const confirmed = [];
      let confirmedEmpty = false;
      view = textItemView({
        didConfirmSelection: (item) => confirmed.push(item),
        didConfirmEmptySelection: () => (confirmedEmpty = true),
      });

      view.confirmSelection();
      expect(confirmed).toEqual(["one"]);

      view.refs.queryEditor.setText("zzz");
      await nextUpdate();
      view.confirmSelection();
      expect(confirmedEmpty).toBe(true);
    });

    it("invokes didCancelSelection on cancel", () => {
      let cancelled = false;
      view = textItemView({ didCancelSelection: () => (cancelled = true) });
      view.cancelSelection();
      expect(cancelled).toBe(true);
    });
  });

  describe("panel management", () => {
    it("shows and hides a modal panel and focuses the query editor", () => {
      view = textItemView();
      expect(view.isVisible()).toBe(false);

      view.show();
      expect(view.isVisible()).toBe(true);
      expect(atom.workspace.getModalPanels()).toContain(view.panel);
      expect(view.element.contains(document.activeElement)).toBe(true);

      view.hide();
      expect(view.isVisible()).toBe(false);

      view.toggle();
      expect(view.isVisible()).toBe(true);
    });

    it("creates the panel hidden on getPanel() and reuses it on show()", () => {
      view = textItemView();
      const panel = view.getPanel();
      expect(panel.isVisible()).toBe(false);
      expect(atom.workspace.getModalPanels()).toContain(panel);

      view.show();
      expect(view.panel).toBe(panel);
      expect(panel.isVisible()).toBe(true);
    });

    it("exposes panelItem as the panel's item", () => {
      const wrapper = {};
      view = textItemView({ panelItem: wrapper });
      wrapper.element = view.element;

      expect(view.getPanel().getItem()).toBe(wrapper);
    });

    it("calls willShow whenever the panel becomes visible", () => {
      let willShowCalls = 0;
      view = textItemView({
        willShow: () => willShowCalls++,
      });
      view.show();
      expect(willShowCalls).toBe(1);

      // Showing while already visible does not re-run it.
      view.show();
      expect(willShowCalls).toBe(1);

      // The panel being shown from outside the view runs it too — that is
      // how a modal-flow back navigation refreshes the list.
      view.hide();
      view.getPanel().show();
      expect(willShowCalls).toBe(2);
    });

    it("destroys its panel on destroy", async () => {
      view = textItemView();
      const panel = view.getPanel();
      await view.destroy();
      view = null;
      expect(atom.workspace.getModalPanels()).not.toContain(panel);
    });
  });

  describe("initiallyVisibleItemCount", () => {
    it("renders items beyond the count with visible: false", () => {
      const items = [];
      for (let i = 0; i < 10; i++) items.push(`item-${i}`);

      view = new SelectListView({
        items,
        initiallyVisibleItemCount: 4,
        elementForItem: (item, { visible }) => {
          const li = document.createElement("li");
          if (visible) li.textContent = item;
          return li;
        },
      });

      const texts = listTexts();
      expect(texts.length).toBe(10);
      expect(texts.slice(0, 4)).toEqual(["item-0", "item-1", "item-2", "item-3"]);
      expect(texts.slice(4).every((text) => text === "")).toBe(true);
    });

    it("re-renders an item with visible: true when selected", async () => {
      const items = ["a", "b", "c"];
      view = new SelectListView({
        items,
        initiallyVisibleItemCount: 1,
        elementForItem: (item, { visible }) => {
          const li = document.createElement("li");
          if (visible) li.textContent = item;
          return li;
        },
      });
      expect(listTexts()).toEqual(["a", "", ""]);

      await view.selectNext();
      expect(listTexts()).toEqual(["a", "b", ""]);
    });

    it("always reports visible: true when the feature is off", () => {
      const seen = [];
      view = new SelectListView({
        items: ["x"],
        elementForItem: (item, { visible }) => {
          seen.push(visible);
          return document.createElement("li");
        },
      });
      expect(seen).toEqual([true]);
    });
  });

  describe("update()", () => {
    it("replaces items, query and messages", async () => {
      view = textItemView();

      await view.update({ items: ["four", "five"] });
      expect(listTexts()).toEqual(["four", "five"]);

      await view.update({ query: "fi" });
      expect(listTexts()).toEqual(["five"]);

      await view.update({ errorMessage: "boom", infoMessage: "fyi", loadingMessage: "wait" });
      expect(view.refs.errorMessage.textContent).toBe("boom");
      expect(view.refs.infoMessage.textContent).toBe("fyi");
      expect(view.refs.loadingMessage.textContent).toBe("wait");
    });
  });

  describe("contentElement", () => {
    it("renders the content element inside the panel and preserves it across updates", async () => {
      const content = document.createElement("div");
      content.className = "custom-content";
      view = textItemView({ contentElement: content });
      expect(view.element.contains(content)).toBe(true);

      view.refs.queryEditor.setText("tw");
      await nextUpdate();
      expect(view.element.contains(content)).toBe(true);

      const replacement = document.createElement("div");
      await view.update({ contentElement: replacement });
      expect(view.element.contains(content)).toBe(false);
      expect(view.element.contains(replacement)).toBe(true);
    });

    it("supports dialog-style views with no items", () => {
      const content = document.createElement("div");
      content.textContent = "dialog body";
      let confirmedEmpty = false;
      view = new SelectListView({
        items: [],
        contentElement: content,
        didConfirmEmptySelection: () => (confirmedEmpty = true),
      });
      expect(view.element.contains(content)).toBe(true);
      expect(view.element.querySelector("li")).toBeNull();

      view.confirmSelection();
      expect(confirmedEmpty).toBe(true);
    });

  });

  describe("show more", () => {
    function bigListView(count = 250, props = {}) {
      return textItemView({
        items: Array.from({ length: count }, (_, i) => `item-${String(i).padStart(3, "0")}`),
        ...props,
      });
    }

    it("caps the list at 99 by default and ends it with the Show more row", () => {
      view = bigListView();
      const rows = view.element.querySelectorAll("li");
      expect(rows.length).toBe(100);
      expect(rows[99].textContent).toBe("Show more…");
      expect(rows[99].classList.contains("show-more-item")).toBe(true);
    });

    it("renders no Show more row when everything fits", () => {
      view = bigListView(99);
      const rows = view.element.querySelectorAll("li");
      expect(rows.length).toBe(99);
      expect(view.element.querySelector(".show-more-item")).toBeNull();
    });

    it("treats maxResults as the batch size, not a hard drop", async () => {
      view = bigListView(12, { maxResults: 5 });
      expect(view.element.querySelectorAll("li").length).toBe(6);

      await view.showMore();
      expect(view.element.querySelectorAll("li").length).toBe(11);

      await view.showMore();
      const rows = view.element.querySelectorAll("li");
      expect(rows.length).toBe(12);
      expect(view.element.querySelector(".show-more-item")).toBeNull();
    });

    it("expands on confirm and selects the first newly revealed item", async () => {
      const confirmed = [];
      view = bigListView(12, {
        maxResults: 5,
        didConfirmSelection: (item) => confirmed.push(item),
      });
      // selectIndex is the raw path a mouse click takes — no auto-expand.
      await view.selectIndex(5);
      expect(view.getSelectedItem()).toBeNull();

      view.confirmSelection();
      await view.constructor.getScheduler().getNextUpdatePromise();

      expect(confirmed).toEqual([]);
      expect(view.getSelectedItem()).toBe("item-005");
    });

    it("reports null selection while the Show more row is highlighted", async () => {
      const selections = [];
      view = bigListView(200, { didChangeSelection: (item) => selections.push(item) });
      await view.selectIndex(view.items.length - 1);
      expect(selections[selections.length - 1]).toBeNull();
    });

    it("auto-expands when keyboard navigation touches the row", async () => {
      const confirmed = [];
      view = bigListView(12, {
        maxResults: 5,
        didConfirmSelection: (item) => confirmed.push(item),
      });
      await view.selectIndex(4);

      await view.selectNext();

      expect(confirmed).toEqual([]);
      expect(view.element.querySelectorAll("li").length).toBe(11);
      expect(view.getSelectedItem()).toBe("item-005");
    });

    it("auto-expands on the wrap-around and on select-last, one batch at a time", async () => {
      view = bigListView(12, { maxResults: 5 });

      // Wrapping upward from the first item lands on the row: expand instead.
      await view.selectPrevious();
      expect(view.getSelectedItem()).toBe("item-005");
      expect(view.element.querySelectorAll("li").length).toBe(11);

      // Select-last touches the new row: one more batch, no chain.
      await view.selectLast();
      expect(view.getSelectedItem()).toBe("item-010");
      expect(view.element.querySelectorAll("li").length).toBe(12);
      expect(view.element.querySelector(".show-more-item")).toBeNull();
    });

    it("expands the rest of the matches before it empties the selection", async () => {
      view = bigListView(12, { maxResults: 5, allowEmptySelection: true });
      await view.selectIndex(4);

      // The bottom of the list is the Show more row, not the end of the
      // matches, so stepping down reveals them rather than leaving the list.
      await view.selectNext();
      expect(view.getSelectedItem()).toBe("item-005");

      await view.selectLast();
      expect(view.getSelectedItem()).toBe("item-010");
      await view.selectNext();
      expect(view.getSelectedItem()).toBe("item-011");

      // Now the end of the list really is the end of the matches.
      await view.selectNext();
      expect(view.getSelectedItem()).toBeNull();
    });

    it("starts from the base cap again when the query changes", async () => {
      view = bigListView();
      await view.showMore();
      expect(view.element.querySelectorAll("li").length).toBe(199);

      view.refs.queryEditor.setText("item-0");
      await nextUpdate();

      // 100 matches (item-000 … item-099) cap back to 99 plus the row.
      expect(view.element.querySelectorAll("li").length).toBe(100);
      expect(view.element.querySelector(".show-more-item")).not.toBeNull();
    });

    it("keeps the scroll position when the row is clicked", async () => {
      view = bigListView();
      view.show();
      const scroller = view.refs.items;
      scroller.style.maxHeight = "100px";
      scroller.style.overflowY = "auto";
      scroller.scrollTop = scroller.scrollHeight;
      const before = scroller.scrollTop;
      expect(before).toBeGreaterThan(0);

      view.didClickItem(view.items.length - 1);
      await view.constructor.getScheduler().getNextUpdatePromise();

      expect(view.refs.items).toBe(scroller);
      expect(scroller.scrollTop).toBe(before);
    });

    it("scrolls the viewport to the selection when keyboard navigation expands from afar", async () => {
      view = bigListView();
      view.show();
      const scroller = view.refs.items;
      scroller.style.maxHeight = "100px";
      scroller.style.overflowY = "auto";
      scroller.scrollTop = 0;
      await view.selectIndex(0);

      await view.selectLast();

      expect(view.getSelectedItem()).toBe("item-099");
      expect(scroller.scrollTop).toBeGreaterThan(0);
      const selected = view.element.querySelector("li.selected");
      const selRect = selected.getBoundingClientRect();
      const scrRect = scroller.getBoundingClientRect();
      expect(selRect.top).not.toBeLessThan(scrRect.top - 1);
      expect(selRect.bottom).not.toBeGreaterThan(scrRect.bottom + 1);
    });

    it("never hands the sentinel to the consumer's renderer or filter key", () => {
      const rendered = [];
      const keyed = [];
      view = new SelectListView({
        items: Array.from({ length: 150 }, (_, i) => ({ name: `n${i}` })),
        filterKeyForItem: (item) => {
          keyed.push(item);
          return item.name;
        },
        elementForItem: (item) => {
          rendered.push(item);
          const li = document.createElement("li");
          li.textContent = item.name;
          return li;
        },
      });

      expect(rendered.some((item) => item.showMoreSentinel)).toBe(false);
      expect(keyed.some((item) => item.showMoreSentinel)).toBe(false);
      expect(view.element.querySelector(".show-more-item")).not.toBeNull();
    });
  });

  describe("item actions", () => {
    let dispatched, disposables;

    beforeEach(() => {
      dispatched = [];
      // A package-shaped setup: commands in the package's own namespace,
      // registered on the list's element, a keybinding scoped to the
      // package's own class.
      view = textItemView({ className: "spec-master", crumb: "Files" });
      disposables = new CompositeDisposable(
        atom.commands.add(view.element, {
          "spec:test-action": {
            description: "Does the test thing",
            didDispatch: () => dispatched.push("spec:test-action"),
          },
          "spec:other-action": () => dispatched.push("spec:other-action"),
        }),
        atom.commands.add("atom-workspace", "spec:global-action", () => {}),
        atom.keymaps.add("item-actions-spec", {
          ".spec-master atom-text-editor[mini]": { "alt-x": "spec:test-action" },
        }),
      );
    });

    afterEach(() => {
      disposables.dispose();
    });

    it("derives the rows from the dialog's own commands and keymaps", async () => {
      view.show();
      await view.showItemActions();

      const actions = view.itemActionsList.props.items;
      const test = actions.find((action) => action.command === "spec:test-action");
      expect(test.name).toBe("Test Action");
      expect(test.description).toBe("Does the test thing");
      expect(test.keystrokes).toEqual(["alt-x"]);
      expect(actions.some((action) => action.command === "spec:other-action")).toBe(true);
      // Commands from outside the dialog and its own chrome stay out.
      expect(actions.some((action) => action.command === "spec:global-action")).toBe(false);
      expect(actions.some((action) => action.command === "core:confirm")).toBe(false);
      expect(actions.some((action) => action.command === "select-list:actions")).toBe(false);
      expect(atom.workspace.getModalTrail()).toEqual(["Files", "Actions"]);
      expect(view.itemActionsList.props.infoMessage).toBe("one");
    });

    it("renders name, description, and keybinding like the command palette", async () => {
      view.show();
      await view.showItemActions();
      await view.itemActionsList.constructor.getScheduler().getNextUpdatePromise();

      const row = Array.from(view.itemActionsList.element.querySelectorAll("li")).find((li) =>
        li.textContent.includes("Test Action"),
      );
      expect(row.querySelector(".secondary-line").textContent).toBe("Does the test thing");
      // Keystrokes render humanized, the way the command palette writes them.
      expect(row.querySelector(".key-binding").textContent).toBe("Alt+X");
    });

    it("runs a confirmed action against the re-shown master list", async () => {
      view.show();
      await view.showItemActions();

      const index = view.itemActionsList.items.findIndex(
        (item) => item.command === "spec:test-action",
      );
      view.itemActionsList.selectIndex(index);
      view.itemActionsList.confirmSelection();

      expect(dispatched).toEqual(["spec:test-action"]);
      expect(view.isVisible()).toBeTruthy();
      expect(view.itemActionsList.isVisible()).toBeFalsy();
      expect(atom.workspace.getModalTrail()).toEqual(["Files"]);
    });

    it("keeps the action keybinding working inside the actions list", async () => {
      view.show();
      await view.showItemActions();

      // The dynamic keymap carries the binding into the actions context...
      const bindings = atom.keymaps.findKeyBindings({
        command: "spec:test-action",
        target: view.itemActionsList.refs.queryEditor.element,
      });
      expect(bindings.some((binding) => binding.keystrokes === "alt-x")).toBe(true);

      // ...and the forwarder runs the action against the master list.
      atom.commands.dispatch(view.itemActionsList.element, "spec:test-action");
      expect(dispatched).toEqual(["spec:test-action"]);
      expect(view.isVisible()).toBeTruthy();
    });

    it("toggles back to the master when the actions command fires in the actions list", async () => {
      view.show();
      await view.showItemActions();
      expect(view.itemActionsList.isVisible()).toBeTruthy();

      atom.commands.dispatch(view.itemActionsList.element, "select-list:actions");

      expect(view.isVisible()).toBeTruthy();
      expect(view.itemActionsList.isVisible()).toBeFalsy();
      expect(atom.workspace.getModalTrail()).toEqual(["Files"]);
    });

    it("stops forwarding an action after the actions list hides", async () => {
      view.show();
      await view.showItemActions();

      view.itemActionsList.hide();
      atom.commands.dispatch(view.itemActionsList.element, "spec:test-action");

      expect(dispatched).toEqual([]);
    });

    it("does nothing when the list offers no actions", async () => {
      disposables.dispose();
      view.show();
      await view.showItemActions();
      expect(view.itemActionsList).toBeUndefined();
    });
  });

  describe("helpers", () => {
    it("getMatchIndices returns the matched character positions", () => {
      const indices = getMatchIndices("MyComponent.js", "mcjs");
      expect(Array.isArray(indices)).toBe(true);
      expect(indices.length).toBe(4);
      expect(getMatchIndices("abc", "zzz")).toBeNull();
    });

    it("highlightMatches wraps matched characters in .character-match spans", () => {
      const fragment = highlightMatches("abcdef", [0, 1, 3]);
      const el = document.createElement("div");
      el.appendChild(fragment);
      expect(el.textContent).toBe("abcdef");
      const matches = Array.from(el.querySelectorAll(".character-match"), (m) => m.textContent);
      expect(matches).toEqual(["ab", "d"]);
    });

    it("createTwoLineItem builds a two-line li with icon classes", () => {
      const li = createTwoLineItem({ primary: "top", secondary: "bottom", icon: ["icon-file"] });
      expect(li.classList.contains("two-lines")).toBe(true);
      expect(li.querySelector(".primary-line").classList.contains("icon-file")).toBe(true);
      expect(li.querySelector(".primary-text").textContent).toBe("top");
      expect(li.querySelector(".secondary-line").textContent).toBe("bottom");
    });

    it("createTwoLineItem omits two-lines when there is no secondary line", () => {
      const li = createTwoLineItem({ primary: "top" });
      expect(li.classList.contains("two-lines")).toBe(false);
      expect(li.querySelector(".secondary-line")).toBeNull();

      const empty = createTwoLineItem({ primary: "top", secondary: "" });
      expect(empty.classList.contains("two-lines")).toBe(true);
      expect(empty.querySelector(".secondary-line").textContent).toBe("");
    });

    it("createTwoLineItem applies className as a string or an array", () => {
      const fromString = createTwoLineItem({ primary: "top", className: "alpha beta" });
      expect(fromString.classList.contains("alpha")).toBe(true);
      expect(fromString.classList.contains("beta")).toBe(true);

      const fromArray = createTwoLineItem({ primary: "top", className: ["alpha", "beta"] });
      expect(fromArray.classList.contains("alpha")).toBe(true);
      expect(fromArray.classList.contains("beta")).toBe(true);
    });

    it("createTwoLineItem renders trailing nodes and descriptors, skipping falsy entries", () => {
      const node = document.createElement("span");
      node.textContent = "node";
      const li = createTwoLineItem({
        primary: "top",
        trailing: [null, { text: "+3", className: "status-added" }, false, node],
      });

      const block = li.querySelector(".primary-line .trailing-block");
      expect(block.children.length).toBe(2);
      expect(block.children[0].textContent).toBe("+3");
      expect(block.children[0].classList.contains("status-added")).toBe(true);
      expect(block.children[1]).toBe(node);
    });

    it("createTwoLineItem emits no trailing block when there is nothing to show", () => {
      expect(createTwoLineItem({ primary: "top" }).querySelector(".trailing-block")).toBeNull();
      expect(
        createTwoLineItem({ primary: "top", trailing: [] }).querySelector(".trailing-block"),
      ).toBeNull();
      expect(
        createTwoLineItem({ primary: "top", trailing: [null, false] }).querySelector(
          ".trailing-block",
        ),
      ).toBeNull();
    });

    it("createTrailingBlock accepts a lone node and returns null when empty", () => {
      const node = document.createElement("span");
      const block = createTrailingBlock(node);
      expect(block.classList.contains("trailing-block")).toBe(true);
      expect(block.children[0]).toBe(node);
      expect(createTrailingBlock([])).toBeNull();
    });
  });
});
