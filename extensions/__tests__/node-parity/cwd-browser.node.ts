/**
 * Node parity target for the cwd directory browser.
 *
 * The retired source path was extensions/__tests__/cwd-browser.test.ts.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";
import { DirectoryBrowser } from "../../cwd-internals/directory-browser.ts";
import {
	createDirectoryFixture,
	KEY_BACKSPACE,
	KEY_DOWN,
	KEY_END,
	KEY_ENTER,
	KEY_ESCAPE,
	KEY_HOME,
	KEY_LEFT,
	KEY_UP,
	testTheme,
} from "../cwd-test-helpers.ts";

describe("DirectoryBrowser", () => {
	test("initializes at an absolute path and lists sorted visible directories only", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(root, testTheme);

		assert.strictEqual(browser.getCurrentPath(), root);
		assert.deepStrictEqual(browser.getEntryNames(), ["alpha", "zeta"]);
	});

	test("moves selection with up and down keys", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);

		assert.strictEqual(browser.getSelectedIndex(), 0);
		browser.handleInput(KEY_DOWN);
		assert.strictEqual(browser.getSelectedIndex(), 1);
		browser.handleInput(KEY_DOWN);
		assert.strictEqual(browser.getSelectedIndex(), 2);
		browser.handleInput(KEY_DOWN);
		assert.strictEqual(browser.getSelectedIndex(), 3);
		browser.handleInput(KEY_DOWN);
		assert.strictEqual(browser.getSelectedIndex(), 3);
		browser.handleInput(KEY_UP);
		assert.strictEqual(browser.getSelectedIndex(), 2);
	});

	test("home and end jump to first and last selectable items", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);

		browser.handleInput(KEY_END);
		assert.strictEqual(browser.getSelectedIndex(), 3);
		browser.handleInput(KEY_HOME);
		assert.strictEqual(browser.getSelectedIndex(), 0);
	});

	test("enter on use-this-directory selects the current path", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(root, testTheme);
		const selectedPaths: string[] = [];
		browser.onSelect = (path) => {
			selectedPaths.push(path);
		};

		browser.handleInput(KEY_ENTER);

		assert.deepStrictEqual(selectedPaths, [root]);
	});

	test("enter on a subdirectory updates the current path", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(root, testTheme);

		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_ENTER);

		assert.strictEqual(browser.getCurrentPath(), join(root, "alpha"));
		assert.strictEqual(browser.getSelectedIndex(), 0);
	});

	test("backspace and left go to the parent directory", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(join(root, "alpha"), testTheme);

		browser.handleInput(KEY_BACKSPACE);
		assert.strictEqual(browser.getCurrentPath(), root);

		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_ENTER);
		assert.strictEqual(browser.getCurrentPath(), join(root, "alpha"));

		browser.handleInput(KEY_LEFT);
		assert.strictEqual(browser.getCurrentPath(), root);
	});

	test("escape cancels the browser", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);
		let cancelled = false;
		browser.onCancel = () => {
			cancelled = true;
		};

		browser.handleInput(KEY_ESCAPE);

		assert.strictEqual(cancelled, true);
	});

	test("does not render a parent entry at filesystem root", () => {
		const browser = new DirectoryBrowser("/", testTheme);

		assert.strictEqual(
			browser.render(80).some((line) => line.includes("..")),
			false,
		);
	});

	test("caches render output and invalidates on state changes", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);

		const firstRender = browser.render(80);
		assert.strictEqual(browser.render(80), firstRender);
		browser.handleInput(KEY_DOWN);
		assert.notStrictEqual(browser.render(80), firstRender);
	});
});
