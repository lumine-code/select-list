const { InputDialogView, SelectListView } = require("../lib/select-list");

describe("InputDialogView", () => {
  let view;

  beforeEach(() => {
    jasmine.attachToDOM(atom.views.getView(atom.workspace));
  });

  afterEach(async () => {
    if (view) {
      await view.destroy();
      view = null;
    }
  });

  describe("rendering", () => {
    it("renders a query editor with the input-dialog root class and custom classes", () => {
      view = new InputDialogView({ className: "my-package my-dialog" });
      expect(view.element.classList.contains("input-dialog")).toBe(true);
      expect(view.element.classList.contains("select-list")).toBe(false);
      expect(view.element.classList.contains("my-dialog")).toBe(true);
      expect(view.refs.queryEditor).toBeDefined();
      expect(view.element.querySelector("ol")).toBeNull();
    });

    it("hosts a caller-owned content element and preserves it across updates", async () => {
      const content = document.createElement("div");
      content.className = "dialog-body";
      view = new InputDialogView({ contentElement: content });
      expect(view.element.contains(content)).toBe(true);

      await view.update({ infoMessage: "changed" });
      expect(view.element.contains(content)).toBe(true);

      const replacement = document.createElement("div");
      await view.update({ contentElement: replacement });
      expect(view.element.contains(content)).toBe(false);
      expect(view.element.contains(replacement)).toBe(true);
    });

    it("renders info, error, and loading messages via update()", async () => {
      view = new InputDialogView({});
      await view.update({ errorMessage: "boom", infoMessage: "fyi", loadingMessage: "wait" });
      expect(view.refs.errorMessage.textContent).toBe("boom");
      expect(view.refs.infoMessage.textContent).toBe("fyi");
      expect(view.refs.loadingMessage.textContent).toBe("wait");
    });

    it("renders a header element above the query editor", () => {
      const header = document.createElement("label");
      header.textContent = "Prompt";
      view = new InputDialogView({ headerElement: header });
      const children = Array.from(view.element.children);
      const headerIndex = children.indexOf(header);
      const editorIndex = children.findIndex((child) =>
        child.contains(view.refs.queryEditor.element),
      );
      expect(headerIndex).toBe(0);
      expect(headerIndex).toBeLessThan(editorIndex);
    });
  });

  describe("checkboxes", () => {
    const CONFIG_KEY = "input-dialog-spec.flag";

    afterEach(() => {
      atom.config.unset(CONFIG_KEY);
    });

    it("reflects the bound config value and updates it on toggle", () => {
      atom.config.set(CONFIG_KEY, true);
      view = new InputDialogView({
        checkboxes: [{ label: "Do the thing", config: CONFIG_KEY }],
      });
      const input = view.element.querySelector(".input-checkbox");
      expect(input.checked).toBe(true);
      expect(view.element.querySelector(".input-label-text").textContent).toBe("Do the thing");

      input.checked = false;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      expect(atom.config.get(CONFIG_KEY)).toBe(false);
    });

    it("re-renders when the bound config changes externally", async () => {
      atom.config.set(CONFIG_KEY, false);
      view = new InputDialogView({
        checkboxes: [{ label: "Flag", config: CONFIG_KEY }],
      });
      expect(view.element.querySelector(".input-checkbox").checked).toBe(false);

      atom.config.set(CONFIG_KEY, true);
      await InputDialogView.getScheduler().getNextUpdatePromise();
      expect(view.element.querySelector(".input-checkbox").checked).toBe(true);
    });

    it("keeps local state and calls onChange for unbound checkboxes", () => {
      const changes = [];
      view = new InputDialogView({
        checkboxes: [{ label: "Local", checked: false, onChange: (c) => changes.push(c) }],
      });
      const input = view.element.querySelector(".input-checkbox");
      expect(input.checked).toBe(false);

      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      expect(changes).toEqual([true]);
      expect(view.localCheckboxState.get(0)).toBe(true);
    });

    it("returns focus to the query editor after a toggle so Enter still confirms", () => {
      view = new InputDialogView({ checkboxes: [{ label: "Flag", checked: false }] });
      view.show();
      const input = view.element.querySelector(".input-checkbox");
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      expect(view.refs.queryEditor.element.contains(document.activeElement)).toBe(true);
    });
  });

  describe("confirm and cancel", () => {
    it("confirms with the raw query text", () => {
      const confirmed = [];
      view = new InputDialogView({ didConfirm: (query) => confirmed.push(query) });
      view.refs.queryEditor.setText("hello world");
      view.confirm();
      expect(confirmed).toEqual(["hello world"]);
    });

    it("invokes didCancel on cancel", () => {
      let cancelled = false;
      view = new InputDialogView({ didCancel: () => (cancelled = true) });
      view.cancel();
      expect(cancelled).toBe(true);
    });

    it("reports query changes through didChangeQuery", () => {
      const queries = [];
      view = new InputDialogView({ didChangeQuery: (query) => queries.push(query) });
      view.refs.queryEditor.setText("abc");
      expect(queries).toEqual(["abc"]);
    });
  });

  describe("panel management", () => {
    it("shows and hides a modal panel and focuses the query editor", () => {
      view = new InputDialogView({});
      expect(view.isVisible()).toBe(false);

      view.show();
      expect(view.isVisible()).toBe(true);
      expect(atom.workspace.getModalPanels()).toContain(view.panel);
      expect(view.element.contains(document.activeElement)).toBe(true);

      view.hide();
      expect(view.isVisible()).toBe(false);
    });

    it("cancels when focus moves outside the dialog", async () => {
      let cancelled = false;
      view = new InputDialogView({ didCancel: () => (cancelled = true) });
      view.show();

      const outside = document.createElement("input");
      atom.views.getView(atom.workspace).appendChild(outside);
      outside.focus();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      outside.remove();
      expect(cancelled).toBe(true);
    });
  });

  describe("focus policy", () => {
    it("keeps focus in the query editor when pressing non-interactive content", () => {
      const content = document.createElement("div");
      content.textContent = "static";
      view = new InputDialogView({ contentElement: content });
      view.show();

      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      content.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it("lets interactive controls inside the content take focus", () => {
      const content = document.createElement("div");
      const input = document.createElement("input");
      content.appendChild(input);
      view = new InputDialogView({ contentElement: content });
      view.show();

      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);

      input.focus();
      expect(document.activeElement).toBe(input);
    });

    it("does not refocus when focus moves into the query editor's own subtree", () => {
      // Refocusing here would re-fire focusout and recurse (RangeError). The
      // guard skips the refocus when the new focus target is inside the editor.
      view = new InputDialogView({});
      view.show();
      const editorElement = view.refs.queryEditor.element;
      const inner = editorElement.querySelector("input") || editorElement;
      spyOn(editorElement, "focus");

      const event = new FocusEvent("focusout", { bubbles: true, relatedTarget: inner });
      view.element.dispatchEvent(event);

      expect(editorElement.focus).not.toHaveBeenCalled();
    });
  });

  describe("help toggling via backtick", () => {
    function backtickEvent() {
      return new KeyboardEvent("keydown", { key: "`", bubbles: true, cancelable: true });
    }

    it("toggles help when help content exists", () => {
      view = new InputDialogView({ helpMessage: "<p>help</p>" });
      const event = backtickEvent();
      view.refs.queryEditor.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(view.showHelp).toBe(true);
    });

    it("types normally when no help content exists", () => {
      view = new InputDialogView({});
      const event = backtickEvent();
      view.refs.queryEditor.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(view.showHelp).toBe(false);
    });
  });

  describe("class hierarchy", () => {
    it("is the base class of SelectListView", () => {
      expect(Object.getPrototypeOf(SelectListView)).toBe(InputDialogView);
    });
  });
});
