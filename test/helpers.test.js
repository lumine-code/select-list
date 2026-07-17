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

global.atom = { ui: { fuzzyMatcher } };

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
  if (request === "etch") {
    return {
      dom() {},
      getScheduler() {},
      setScheduler() {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let selectList;
try {
  selectList = require("../lib/select-list");
} finally {
  Module._load = originalLoad;
}

test.after(() => {
  dom.window.close();
  delete global.atom;
  delete global.document;
});

test("preserves the CommonJS default and named class exports", () => {
  assert.equal(selectList, selectList.SelectListView);
  assert.equal(typeof selectList.SelectListView, "function");
  assert.equal(typeof selectList.InputDialogView, "function");
  assert.equal(
    Object.getPrototypeOf(selectList.SelectListView),
    selectList.InputDialogView,
  );
});

test("removes diacritics", () => {
  assert.equal(selectList.removeDiacritics("café"), "cafe");
});

test("returns fuzzy match indices", () => {
  assert.deepEqual(selectList.getMatchIndices("abcdef", "ace"), [0, 2, 4]);
  assert.equal(selectList.getMatchIndices("abcdef", "xyz"), null);
});

test("highlights adjacent and separated matches", () => {
  const container = document.createElement("div");
  container.appendChild(selectList.highlightMatches("abcdef", [0, 1, 3]));

  assert.equal(container.textContent, "abcdef");
  assert.deepEqual(
    Array.from(container.querySelectorAll(".character-match"), (element) => element.textContent),
    ["ab", "d"],
  );
});

test("creates two-line items with icon classes", () => {
  const item = selectList.createTwoLineItem({
    primary: "Primary",
    secondary: "Secondary",
    icon: ["icon-file"],
  });

  assert.equal(item.tagName, "LI");
  assert.equal(item.querySelector(".primary-text").textContent, "Primary");
  assert.equal(item.querySelector(".secondary-line").textContent, "Secondary");
  assert.equal(item.querySelector(".primary-line").classList.contains("icon-file"), true);
});
