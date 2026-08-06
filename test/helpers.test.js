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

global.atom = { tools: { fuzzyMatcher } };

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
  if (request === "atom") {
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
  delete global.atom;
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
