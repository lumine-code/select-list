"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.document = dom.window.document;

const fuzzyMatcher = {
  match(text, query) {
    const matchIndexes = [];
    let offset = 0;
    for (const character of query.toLowerCase()) {
      const index = text.toLowerCase().indexOf(character, offset);
      if (index === -1) return null;
      matchIndexes.push(index);
      offset = index + 1;
    }
    return { matchIndexes };
  },
};

global.lumine = { tools: { fuzzyMatcher } };

class Disposable {
  constructor(dispose) {
    this.dispose = dispose;
  }
}

class CompositeDisposable {
  add() {}
  dispose() {}
}

class TextEditor {}

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "lumine") {
    return { Disposable, CompositeDisposable, TextEditor };
  }
  if (request === "@lumine-code/etch") {
    return {
      dom() {},
      getScheduler() {},
      setScheduler() {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let selectList;
let helpers;
try {
  selectList = require("../lib/select-list");
  helpers = require("../lib/helpers");
} finally {
  Module._load = originalLoad;
}

test.after(() => {
  dom.window.close();
  delete global.lumine;
  delete global.document;
});

test("exposes the named class exports", () => {
  assert.equal(typeof selectList.SelectListView, "function");
  assert.equal(typeof selectList.InputDialogView, "function");
  assert.equal(Object.getPrototypeOf(selectList.SelectListView), selectList.InputDialogView);
});

test("exposes nothing but the two view classes", () => {
  assert.deepEqual(Object.keys(selectList).sort(), ["InputDialogView", "SelectListView"]);
});

test("shows one stable panel with crumb as the only presentation option", () => {
  const shows = [];
  const panel = { show: (options) => shows.push(options) };
  let panelRequests = 0;
  const view = Object.assign(Object.create(selectList.InputDialogView.prototype), {
    suspendedByFlow: true,
    getPanel() {
      panelRequests++;
      return panel;
    },
  });

  view.show({ crumb: "Step" });
  view.show();

  assert.equal(view.suspendedByFlow, false);
  assert.equal(panelRequests, 2);
  assert.deepEqual(shows, [{ crumb: "Step" }, undefined]);
  assert.throws(() => view.show({ owner: {} }), /unknown option "owner"/);
  assert.throws(() => view.show({ surface: {} }), /unknown option "surface"/);
});

test("creates one primary modal panel and keeps owner as lifecycle context", () => {
  const originalWorkspace = global.lumine.workspace;
  const owner = {};
  const item = { element: document.createElement("div") };
  const panel = {
    onDidChangeVisible() {
      return new Disposable(() => {});
    },
  };
  let addedOptions;
  global.lumine.workspace = {
    addModalPanel(options) {
      addedOptions = options;
      return panel;
    },
  };
  const view = Object.assign(Object.create(selectList.InputDialogView.prototype), {
    props: { owner, panelItem: item, crumb: "Root", surface: {} },
    element: item.element,
    document,
    disposables: { add() {} },
  });

  try {
    assert.equal(view.getPanel(), panel);
    assert.equal(view.getPanel(), panel);
    assert.deepEqual(addedOptions, { item, visible: false, crumb: "Root", owner });
  } finally {
    global.lumine.workspace = originalWorkspace;
  }
});

test("synchronizes rendering to the primary document after panel insertion", () => {
  const secondary = new JSDOM("<!doctype html><html><body></body></html>");
  const originalWorkspace = global.lumine.workspace;
  const element = secondary.window.document.createElement("div");
  const changes = [];
  const panel = {
    onDidChangeVisible() {
      return new Disposable(() => {});
    },
  };
  global.lumine.workspace = {
    addModalPanel() {
      document.adoptNode(element);
      return panel;
    },
  };
  const view = Object.assign(Object.create(selectList.InputDialogView.prototype), {
    props: {},
    element,
    document: secondary.window.document,
    disposables: { add() {} },
    didChangeDocument(previousDocument, nextDocument) {
      changes.push([previousDocument, nextDocument]);
    },
  });

  try {
    view.getPanel();
    assert.equal(view.document, document);
    assert.deepEqual(changes, [[secondary.window.document, document]]);
  } finally {
    global.lumine.workspace = originalWorkspace;
    secondary.window.close();
  }
});

test("returns fuzzy match indices", () => {
  assert.deepEqual(helpers.getMatchIndices("abcdef", "ace"), [0, 2, 4]);
  assert.equal(helpers.getMatchIndices("abcdef", "xyz"), null);
});

test("highlights adjacent and separated matches", () => {
  const container = document.createElement("div");
  container.appendChild(helpers.highlightMatches("abcdef", [0, 1, 3]));

  assert.equal(container.textContent, "abcdef");
  assert.deepEqual(
    Array.from(container.querySelectorAll(".character-match"), (element) => element.textContent),
    ["ab", "d"],
  );
});

test("creates two-line items with icon classes", () => {
  const item = helpers.createTwoLineItem({
    primary: "Primary",
    secondary: "Secondary",
    icon: ["icon-file"],
  });

  assert.equal(item.tagName, "LI");
  assert.equal(item.querySelector(".primary-text").textContent, "Primary");
  assert.equal(item.querySelector(".secondary-line").textContent, "Secondary");
  assert.equal(item.querySelector(".primary-line").classList.contains("icon-file"), true);
});

test("marks an item as two-lines only when it has a secondary line", () => {
  const single = helpers.createTwoLineItem({ primary: "Primary" });
  assert.equal(single.classList.contains("two-lines"), false);
  assert.equal(single.querySelector(".secondary-line"), null);

  const double = helpers.createTwoLineItem({ primary: "Primary", secondary: "" });
  assert.equal(double.classList.contains("two-lines"), true);
});

test("adds item class names from a string or an array", () => {
  const fromString = helpers.createTwoLineItem({ primary: "Primary", className: "alpha beta" });
  assert.equal(fromString.classList.contains("alpha"), true);
  assert.equal(fromString.classList.contains("beta"), true);

  const fromArray = helpers.createTwoLineItem({
    primary: "Primary",
    className: ["alpha", "beta"],
  });
  assert.equal(fromArray.classList.contains("alpha"), true);
  assert.equal(fromArray.classList.contains("beta"), true);
});

test("renders trailing content and skips falsy entries", () => {
  const node = document.createElement("span");
  node.textContent = "node";
  const item = helpers.createTwoLineItem({
    primary: "Primary",
    trailing: [null, { text: "+3", className: "status-added" }, false, node],
  });

  const block = item.querySelector(".primary-line .trailing-block");
  assert.equal(block.children.length, 2);
  assert.equal(block.children[0].textContent, "+3");
  assert.equal(block.children[0].classList.contains("status-added"), true);
  assert.equal(block.children[1], node);
});

test("omits the trailing block when there is nothing to show", () => {
  for (const trailing of [undefined, [], [null, false]]) {
    const item = helpers.createTwoLineItem({ primary: "Primary", trailing });
    assert.equal(item.querySelector(".trailing-block"), null);
  }

  assert.equal(helpers.createTrailingBlock([]), null);
});
