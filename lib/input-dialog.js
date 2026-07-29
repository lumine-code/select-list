"use strict";

const { Disposable, CompositeDisposable, TextEditor } = require("atom");
const { humanizeKeystroke } = require("@lumine-code/underscore-plus");
const etch = require("@lumine-code/etch");
const $ = etch.dom;

// The dialog's own chrome commands never appear in the item-actions list.
const UNLISTED_ACTIONS = new Set(["select-list:actions"]);

// Elements that should be allowed to receive focus and clicks inside the
// dialog without the focus policy pulling focus back to the query editor.
const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, a[href], [tabindex], atom-text-editor";

/**
 * Modal panel with a mini query editor and optional custom DOM content.
 *
 * InputDialogView owns the behaviors every query-driven modal needs — panel
 * lifecycle, focus and blur handling, `core:confirm`/`core:cancel` commands,
 * and info/error/loading messages — without any list semantics.
 * SelectListView extends it with items, filtering, and selection. Use it
 * directly for dialogs that are not lists (prompts, save dialogs, forms).
 *
 * Custom DOM can be hosted through `headerElement` (above the query editor)
 * and `contentElement` (below the messages). The `checkboxes` prop renders a
 * row of checkboxes; a checkbox with a `config` key is bound to `atom.config`
 * so toggling it updates the setting and propagates to every renderer.
 */
class InputDialogView {
  static schedulerInitialized = false;

  static setScheduler(scheduler) {
    etch.setScheduler(scheduler);
    InputDialogView.schedulerInitialized = true;
  }

  static getScheduler() {
    return etch.getScheduler();
  }

  static initializeScheduler() {
    if (!InputDialogView.schedulerInitialized && typeof atom !== "undefined" && atom.views) {
      etch.setScheduler(atom.views);
      InputDialogView.schedulerInitialized = true;
    }
  }

  constructor(props) {
    InputDialogView.initializeScheduler();
    this.props = props;
    this.localCheckboxState = new Map();
    this.initializeState();
    this.disposables = new CompositeDisposable();
    this.setupCheckboxSubscriptions();
    etch.initialize(this);
    this.disposables.add(atom.textEditors.add(this.refs.queryEditor));
    this.element.classList.add(...this.rootClasses());
    if (props.className) {
      this.element.classList.add(...props.className.split(/\s+/).filter(Boolean));
    }
    this.disposables.add(
      this.refs.queryEditor.onDidChange(() => {
        this.didChangeQuery();
      }),
    );
    if (props.placeholderText) {
      this.refs.queryEditor.setPlaceholderText(props.placeholderText);
    }
    if (!props.skipCommandsRegistration) {
      this.disposables.add(this.registerAtomCommands());
    }
    const didLoseFocus = this.didLoseFocus.bind(this);
    const didMouseDownOnElement = this.didMouseDownOnElement.bind(this);
    this.element.addEventListener("focusout", didLoseFocus);
    this.element.addEventListener("mousedown", didMouseDownOnElement);
    this.disposables.add(
      new Disposable(() => {
        this.element.removeEventListener("focusout", didLoseFocus);
        this.element.removeEventListener("mousedown", didMouseDownOnElement);
      }),
    );
  }

  /**
   * Subclass hook run before the first render to prepare instance state.
   * `this.props` is assigned; the DOM does not exist yet.
   */
  initializeState() {}

  /**
   * CSS classes applied to the root element. Subclasses override to replace
   * the default `input-dialog` class.
   * @returns {string[]} Class names for the root element
   */
  rootClasses() {
    return ["input-dialog"];
  }

  /**
   * Focuses the query editor input.
   */
  focus() {
    this.refs.queryEditor.element.focus();
  }

  /**
   * Handles focus leaving any element inside the dialog.
   * If focus moves within the dialog, refocuses the query editor unless the
   * new target is an interactive control (checkbox, button, custom content
   * input, …). If focus moves outside, cancels after a frame delay.
   * @param {FocusEvent} event - The focusout event
   */
  didLoseFocus(event) {
    // Keep focus on editor when clicking inside the dialog
    if (this.element.contains(event.relatedTarget)) {
      // Focus already moving into the query editor (e.g. its internal input):
      // refocusing would re-fire focusout and recurse.
      if (this.refs.queryEditor.element.contains(event.relatedTarget)) return;
      // Let interactive controls keep the focus they just received.
      if (this.isInteractiveTarget(event.relatedTarget)) return;
      this.refs.queryEditor.element.focus();
      return;
    }
    // Wait for click to complete before canceling
    requestAnimationFrame(() => {
      if (!document.hasFocus() || !this.isVisible()) return;
      if (this.element.contains(document.activeElement)) return;
      this.cancel();
    });
  }

  /**
   * Keeps clicks on the dialog's own surface from moving focus away.
   * CSS pseudo-elements dispatch events as their owning element. Interactive
   * controls (inputs, checkboxes, buttons, links, custom content) are exempt
   * so they can receive focus and clicks normally.
   * @param {MouseEvent} event - The mousedown event
   */
  didMouseDownOnElement(event) {
    // Let the query editor handle its own mousedown (cursor placement, selection)
    if (this.refs.queryEditor.element.contains(event.target)) return;
    if (this.isInteractiveTarget(event.target)) return;
    // Anywhere else inside the panel (messages, list, surface): keep focus on editor
    event.preventDefault();
    this.refs.queryEditor.element.focus();
  }

  /**
   * Returns whether a node is (or is inside) an interactive control that may
   * take focus without the focus policy stealing it back.
   * @param {Node} node - The node to test
   * @returns {boolean} True when the node resolves to an interactive control
   */
  isInteractiveTarget(node) {
    if (!node || !node.closest) return false;
    const match = node.closest(INTERACTIVE_SELECTOR);
    // Bound the match to a control *inside* the dialog. `closest` would
    // otherwise escape upward to workspace-level `[tabindex]` elements and
    // treat every click as interactive.
    return !!match && match !== this.element && this.element.contains(match);
  }

  /**
   * (Re)subscribes to `atom.config` for every checkbox that binds to a config
   * key, so external changes (including from other windows) re-render the
   * checkbox. Config-bound checkboxes are the source of truth for their key;
   * unbound checkboxes keep local state.
   */
  setupCheckboxSubscriptions() {
    if (this.checkboxDisposables) {
      this.checkboxDisposables.dispose();
      this.disposables.remove(this.checkboxDisposables);
      this.checkboxDisposables = null;
    }
    const checkboxes = this.props.checkboxes;
    if (!checkboxes || !checkboxes.length) return;
    this.checkboxDisposables = new CompositeDisposable();
    this.disposables.add(this.checkboxDisposables);
    for (const checkbox of checkboxes) {
      if (checkbox.config && typeof atom !== "undefined" && atom.config) {
        this.checkboxDisposables.add(
          atom.config.onDidChange(checkbox.config, () => etch.update(this)),
        );
      }
    }
  }

  /**
   * Returns the current checked state of a checkbox: the config value when it
   * binds to a config key, otherwise local state (defaulting to `checked`).
   * @param {Object} checkbox - The checkbox descriptor
   * @param {number} index - The checkbox index
   * @returns {boolean} Whether the checkbox is checked
   */
  isCheckboxChecked(checkbox, index) {
    if (checkbox.config && typeof atom !== "undefined" && atom.config) {
      return !!atom.config.get(checkbox.config);
    }
    if (this.localCheckboxState.has(index)) {
      return this.localCheckboxState.get(index);
    }
    return !!checkbox.checked;
  }

  /**
   * Applies a checkbox toggle: writes to config (propagating to all renderers)
   * or local state, invokes the descriptor's `onChange`, and returns focus to
   * the query editor so Enter still confirms.
   * @param {number} index - The toggled checkbox index
   * @param {boolean} checked - The new checked state
   */
  didToggleCheckbox(index, checked) {
    const checkbox = this.props.checkboxes[index];
    if (checkbox.config && typeof atom !== "undefined" && atom.config) {
      atom.config.set(checkbox.config, checked);
    } else {
      this.localCheckboxState.set(index, checked);
    }
    if (checkbox.onChange) {
      checkbox.onChange(checked);
    }
    etch.update(this);
    this.focus();
  }

  /**
   * Clears the query editor text.
   */
  reset() {
    this.refs.queryEditor.setText("");
  }

  /**
   * Destroys the dialog and cleans up resources.
   * @returns {Promise} Resolves when destruction is complete
   */
  destroy() {
    this.disposables.dispose();
    if (this.itemActionsDisposables) {
      this.itemActionsDisposables.dispose();
      this.itemActionsDisposables = null;
    }
    if (this.itemActionsList) {
      this.itemActionsList.destroy();
      this.itemActionsList = null;
    }
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }
    return etch.destroy(this);
  }

  /**
   * Shows the dialog as a modal panel.
   *
   * The dialog reacts to its panel becoming visible — whoever shows it — so
   * the show side effects (willShow, select-all, focus) also run
   * when the panel is shown from outside, e.g. by the modal flow re-showing
   * this dialog on a back navigation.
   *
   * @param {Object} [options] - Passed through to Panel::show. `{crumb:
   *   "Label"}` (or `crumb: true` to use the dialog's `crumb` prop) displays
   *   the dialog as a step of the modal flow: the modal visible at that
   *   moment becomes the previous breadcrumb entry, and Shift-Escape or a
   *   crumb click returns to it. Without options the dialog is shown
   *   standalone, as before.
   */
  show(options) {
    this.getPanel().show(options);
  }

  /**
   * Runs the show side effects. Invoked whenever the panel becomes visible,
   * whether through {InputDialogView::show}, a modal-flow step change, or a
   * back navigation re-showing this dialog.
   */
  didShowPanel() {
    if (this.props.willShow) {
      this.props.willShow();
    }

    this.refs.queryEditor.selectAll();
    this.focus();
  }

  /**
   * Returns the modal panel that hosts the dialog, creating it (hidden) on
   * first access. The panel's item is `props.panelItem` when provided,
   * otherwise the dialog itself. The panel carries the dialog's `crumb` prop
   * as its declared breadcrumb label.
   * @returns {Panel} The modal panel
   */
  getPanel() {
    if (!this.panel) {
      this.panel = atom.workspace.addModalPanel({
        item: this.props.panelItem ?? this,
        visible: false,
        crumb: this.props.crumb,
      });
      // The modal panel container force-hides every other modal panel when one
      // becomes visible, without notifying the owner. A dialog hidden that way
      // is orphaned: its cancel path never runs, so editor state it was meant
      // to restore stays broken and the panel leaks. Treat an unrequested hide
      // as a cancel — unless it is the modal flow moving to another step
      // (panel.flowTransition), which must not cancel the dialog the flow may
      // come back to.
      this.disposables.add(
        this.panel.onDidChangeVisible((visible) => {
          if (visible) {
            this.didShowPanel();
            return;
          }
          if (this.hidingSelf || this.panel.flowTransition) return;
          this.cancel();
        }),
      );
    }
    return this.panel;
  }

  /**
   * Hides the dialog. Focus returns to the previously focused element via the
   * workspace's modal panel focus restoration.
   */
  hide() {
    if (!this.isVisible()) {
      return;
    }

    if (this.panel) {
      this.hidingSelf = true;
      this.panel.hide();
      this.hidingSelf = false;
    }
  }

  /**
   * Toggles the visibility of the dialog.
   */
  toggle() {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Returns whether the dialog is currently visible.
   * @returns {boolean} True if the panel exists and is visible
   */
  isVisible() {
    return Boolean(this.panel?.isVisible());
  }

  registerAtomCommands() {
    return atom.commands.add(this.element, this.commandsForElement());
  }

  /**
   * Returns the command bindings registered on the root element.
   * Subclasses extend the returned object with additional commands.
   * @returns {Object} Command name to handler map
   */
  commandsForElement() {
    return {
      "core:confirm": (event) => {
        this.confirm();
        event.stopPropagation();
      },
      "core:cancel": (event) => {
        this.cancel();
        event.stopPropagation();
      },
      "select-list:actions": (event) => {
        if (this.props.skipItemActions) {
          // F12 toggles: pressed in the actions list itself, it goes back to
          // the dialog it belongs to.
          atom.workspace.popModal();
        } else {
          this.showItemActions();
        }
        event.stopPropagation();
      },
    };
  }

  /**
   * The item actions this dialog offers: the commands it contributes itself —
   * those reachable from its root element but not from the panel's host —
   * each with the label, description, and keybindings it carries in the
   * registry, the same sources the command palette reads. Packages register
   * their actions in their own namespace (`fuzzy-files:open`); the dialog's
   * chrome (`core:*`, `select-list:*` built-ins) stays out. An
   * `actionsFilter(descriptor)` prop replaces the default exclusions.
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
    // Keybindings resolve against the query editor, where dialog keymaps point.
    const bindingTarget = this.refs.queryEditor.element;
    return atom.commands
      .findCommands({ target: this.element })
      .filter((descriptor) => !above.has(descriptor.name))
      .filter(filter)
      .map((descriptor) => ({
        // In a dialog that belongs to one package, the namespace is noise.
        name: descriptor.displayName.replace(/^[^:]+:\s*/, ""),
        description: descriptor.description,
        command: descriptor.name,
        keystrokes: atom.keymaps
          .findKeyBindings({ command: descriptor.name, target: bindingTarget })
          .map((binding) => binding.keystrokes),
      }));
  }

  /**
   * Shows the item-actions list — every command the dialog offers, with its
   * keybinding — as a step of the modal flow. Bound to F12 as
   * `select-list:actions`; F12 in the actions list itself goes back.
   * Confirming an action (or pressing its keybinding right in the actions
   * list) returns here first and then runs the command, exactly as if it was
   * pressed in this dialog.
   */
  async showItemActions() {
    if (this.props.skipItemActions) return;
    const actions = this.itemActions();
    if (actions.length === 0) return;

    if (!this.itemActionsList) {
      // Lazy: select-list.js requires this module while it is still loading,
      // so the class is only reachable after both modules are initialized.
      const { SelectListView } = require("./select-list");
      this.itemActionsList = new SelectListView({
        // The actions list wears the master's classes, so the package's own
        // keymap applies inside it untouched — an action keystroke resolves
        // there exactly as it does in the master. Packages bind actions in
        // their own namespace and leave the chrome keys (enter, escape,
        // navigation, F12) alone, so the base bindings keep working here.
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

    // Command listeners live on this dialog's element, so a keystroke
    // resolved inside the actions list needs a forwarder to reach them.
    // Disposed when the actions list hides, so a stale action set never
    // lingers.
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

    // A select list names the selected item; a plain dialog has no selection.
    const selected = typeof this.getSelectedItem === "function" ? this.getSelectedItem() : null;
    const info =
      selected != null && typeof this.getFilterKey === "function"
        ? this.getFilterKey(selected)
        : null;
    this.itemActionsList.reset();
    await this.itemActionsList.update({
      items: actions,
      infoMessage: info,
    });
    this.itemActionsList.show({ crumb: "Actions" });
  }

  /**
   * Runs an item action: returns to this dialog first — so the handler sees
   * it visible and focused, with its state intact — then dispatches the
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

  /**
   * Confirms the dialog with the current query.
   * Calls the didConfirm callback with the raw query text.
   */
  confirm() {
    if (this.props.didConfirm) {
      this.props.didConfirm(this.getQuery());
    }
  }

  /**
   * Cancels the dialog and calls the didCancel callback if provided.
   */
  cancel() {
    if (this.props.didCancel) {
      this.props.didCancel();
    }
  }

  update(props = {}) {
    this.updateProps(props);
    return etch.update(this);
  }

  /**
   * Applies prop changes shared by every dialog. Subclasses override to
   * handle their own props and call `super.updateProps(props)`.
   * @param {Object} props - The props to apply
   */
  updateProps(props) {
    if ("query" in props) {
      this.refs.queryEditor.setText(props.query);
      // setText triggers didChangeQuery, so derived state refreshes itself
    }

    if ("selectQuery" in props) {
      if (props.selectQuery) {
        this.refs.queryEditor.selectAll();
      } else {
        this.refs.queryEditor.clearSelections();
      }
    }

    if ("errorMessage" in props) {
      this.props.errorMessage = props.errorMessage;
    }

    if ("infoMessage" in props) {
      this.props.infoMessage = props.infoMessage;
    }

    if ("loadingMessage" in props) {
      this.props.loadingMessage = props.loadingMessage;
    }

    if ("loadingSpinner" in props) {
      this.props.loadingSpinner = props.loadingSpinner;
    }

    if ("loadingBadge" in props) {
      this.props.loadingBadge = props.loadingBadge;
    }

    if ("contentElement" in props) {
      this.props.contentElement = props.contentElement;
    }

    if ("headerElement" in props) {
      this.props.headerElement = props.headerElement;
    }

    if ("checkboxes" in props) {
      this.props.checkboxes = props.checkboxes;
      this.setupCheckboxSubscriptions();
    }

    if ("placeholderText" in props) {
      this.props.placeholderText = props.placeholderText;
      this.refs.queryEditor.setPlaceholderText(props.placeholderText || "");
    }

    if ("crumb" in props) {
      this.props.crumb = props.crumb;
      // The panel caches the declared label; keep it in sync.
      if (this.panel) {
        this.panel.crumb = props.crumb;
      }
    }
  }

  render() {
    return $.div(
      {},
      this.renderHeader(),
      this.renderQueryRow(),
      this.renderLoadingMessage(),
      this.renderInfoMessage(),
      this.renderErrorMessage(),
      this.renderCheckboxes(),
      this.renderBody(),
      this.renderContent(),
    );
  }

  renderHeader() {
    if (this.props.headerElement) {
      return $(ContentView, { element: this.props.headerElement });
    } else {
      return "";
    }
  }

  renderCheckboxes() {
    const checkboxes = this.props.checkboxes;
    if (!checkboxes || !checkboxes.length) {
      return "";
    }
    return $.div(
      { className: "input-dialog-checkboxes" },
      ...checkboxes.map((checkbox, index) =>
        $.label(
          { className: "input-label" },
          $.input({
            className: "input-checkbox",
            type: "checkbox",
            checked: this.isCheckboxChecked(checkbox, index),
            on: { change: (event) => this.didToggleCheckbox(index, event.target.checked) },
          }),
          $.span({ className: "input-label-text" }, checkbox.label),
        ),
      ),
    );
  }

  /**
   * Subclass hook rendered between the messages and the custom content.
   * SelectListView renders its items here.
   */
  renderBody() {
    return "";
  }

  renderContent() {
    if (this.props.contentElement) {
      return $(ContentView, { element: this.props.contentElement });
    } else {
      return "";
    }
  }

  renderQueryRow() {
    return $.div({ style: { position: "relative" } }, $(TextEditor, { ref: "queryEditor", mini: true }));
  }

  renderErrorMessage() {
    if (this.props.errorMessage) {
      return $.div({ ref: "errorMessage", className: "error-message" }, this.props.errorMessage);
    } else {
      return "";
    }
  }

  renderInfoMessage() {
    if (this.props.infoMessage) {
      return $.div({ ref: "infoMessage", className: "info-message" }, this.props.infoMessage);
    } else {
      return "";
    }
  }

  renderLoadingMessage() {
    if (this.props.loadingMessage) {
      return $.div(
        { className: "loading", style: "display: flex; align-items: center;" },
        $.div({ ref: "loadingMessage", className: "loading-message" }, this.props.loadingMessage),
        this.props.loadingSpinner
          ? $.span({
              className: "loading-spinner-tiny inline-block",
              style: { marginLeft: "0.5em" },
            })
          : "",
        this.props.loadingBadge
          ? $.span({ ref: "loadingBadge", className: "badge" }, this.props.loadingBadge)
          : "",
      );
    } else {
      return "";
    }
  }

  getQuery() {
    if (this.refs && this.refs.queryEditor) {
      return this.refs.queryEditor.getText();
    } else {
      return "";
    }
  }

  getFilterQuery() {
    return this.props.filterQuery ? this.props.filterQuery(this.getQuery()) : this.getQuery();
  }

  setQueryFromSelection() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) return false;
    const text = editor.getSelectedText();
    if (!text || /\n/.test(text)) return false;
    this.refs.queryEditor.setText(text);
    this.refs.queryEditor.selectAll();
    return true;
  }

  didChangeQuery() {
    if (this.props.didChangeQuery) {
      this.props.didChangeQuery(this.getFilterQuery());
    }
  }
}

/**
 * Etch component that adopts a caller-owned DOM element so raw DOM content can
 * participate in the etch tree. Used for the `contentElement` prop.
 */
class ContentView {
  constructor(props) {
    this.element = props.element;
  }

  update(props) {
    if (props.element !== this.element) {
      if (this.element.parentNode) {
        this.element.parentNode.replaceChild(props.element, this.element);
      }
      this.element = props.element;
    }
  }

  destroy() {
    this.element.remove();
  }
}

module.exports = { InputDialogView, ContentView };
