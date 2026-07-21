"use strict";

const { Disposable, CompositeDisposable, TextEditor } = require("atom");
const etch = require("@lumine-code/etch");
const $ = etch.dom;

// Elements that should be allowed to receive focus and clicks inside the
// dialog without the focus policy pulling focus back to the query editor.
const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, a[href], [tabindex], atom-text-editor";

/**
 * Modal panel with a mini query editor and optional custom DOM content.
 *
 * InputDialogView owns the behaviors every query-driven modal needs — panel
 * lifecycle, focus and blur handling, `core:confirm`/`core:cancel` commands,
 * info/error/loading messages, and help mode — without any list semantics.
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
    this.showHelp = false;
    this.computeHelp();
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
    const editorElement = this.refs.queryEditor.element;
    const didLoseFocus = this.didLoseFocus.bind(this);
    const didMouseDownOnElement = this.didMouseDownOnElement.bind(this);
    this.element.addEventListener("focusout", didLoseFocus);
    this.element.addEventListener("mousedown", didMouseDownOnElement);
    const didKeyDown = (event) => {
      if (event.key === "`" && this.helpMessage) {
        event.stopImmediatePropagation();
        event.preventDefault();
        this.toggleHelp();
      }
    };
    editorElement.addEventListener("keydown", didKeyDown, true);
    this.disposables.add(
      new Disposable(() => {
        this.element.removeEventListener("focusout", didLoseFocus);
        this.element.removeEventListener("mousedown", didMouseDownOnElement);
        editorElement.removeEventListener("keydown", didKeyDown, true);
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
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }
    return etch.destroy(this);
  }

  /**
   * Shows the dialog as a modal panel.
   * Calls the willShow callback if provided.
   */
  show() {
    if (this.isVisible()) {
      return;
    }

    if (this.showHelp) {
      this.toggleHelp();
    }

    if (this.props.willShow) {
      this.props.willShow();
    }

    this.refs.queryEditor.selectAll();

    this.getPanel().show();
    this.focus();
  }

  /**
   * Returns the modal panel that hosts the dialog, creating it (hidden) on
   * first access. The panel's item is `props.panelItem` when provided,
   * otherwise the dialog itself.
   * @returns {Panel} The modal panel
   */
  getPanel() {
    if (!this.panel) {
      this.panel = atom.workspace.addModalPanel({
        item: this.props.panelItem ?? this,
        visible: false,
      });
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
      this.panel.hide();
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
    return this.panel && this.panel.isVisible();
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
      "select-list:help": (event) => {
        this.toggleHelp();
        event.stopPropagation();
      },
    };
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
    let shouldComputeHelp = false;

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

    if ("helpMessage" in props) {
      this.props.helpMessage = props.helpMessage;
      shouldComputeHelp = true;
    }

    if ("helpMarkdown" in props) {
      this.props.helpMarkdown = props.helpMarkdown;
      shouldComputeHelp = true;
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

    if (shouldComputeHelp) {
      this.computeHelp();
    }
  }

  render() {
    if (this.isHelpMode()) {
      return $.div({}, this.renderHeader(), this.renderQueryRow(), this.renderHelpMessage());
    } else {
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
    const helpToggle = this.helpMessage
      ? $.span({
          className: "icon-question",
          style: {
            position: "absolute",
            right: "8px",
            top: "50%",
            transform: "translateY(-50%)",
            cursor: "pointer",
            opacity: "0.5",
            zIndex: "1",
          },
          on: {
            mousedown: (e) => e.preventDefault(),
            click: () => this.toggleHelp(),
            mouseenter: (e) => (e.target.style.opacity = "1"),
            mouseleave: (e) => (e.target.style.opacity = "0.5"),
          },
        })
      : "";
    return $.div(
      { style: { position: "relative" } },
      $(TextEditor, { ref: "queryEditor", mini: true }),
      helpToggle,
    );
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

  renderHelpMessage() {
    if (!this.showHelp || !this.helpMessage) {
      return "";
    }
    const isMarkdown = !this.props.helpMessage && this.props.helpMarkdown;
    return $.div({
      key: "help",
      ref: "helpMessage",
      className: "help-message" + (isMarkdown ? " markdown" : ""),
      innerHTML: this.helpMessage,
    });
  }

  computeHelp() {
    if (this.props.helpMessage) {
      this.helpMessage = this.props.helpMessage;
    } else if (this.props.helpMarkdown) {
      if (atom.ui && atom.ui.markdown && atom.ui.markdown.render) {
        this.helpMessage = atom.ui.markdown.render(this.props.helpMarkdown);
      } else {
        // Fallback: escape and wrap as text
        const escaped = this.props.helpMarkdown.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        this.helpMessage = `<p>${escaped}</p>`;
      }
    } else {
      this.helpMessage = false;
    }
  }

  isHelpMode() {
    return this.helpMessage && this.showHelp;
  }

  toggleHelp() {
    if (!this.helpMessage) {
      return;
    }
    this.showHelp = !this.showHelp;
    return etch.update(this);
  }

  hideHelp() {
    if (this.showHelp) {
      this.showHelp = false;
      return etch.update(this);
    }
    return Promise.resolve();
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

    this.hideHelp();
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
