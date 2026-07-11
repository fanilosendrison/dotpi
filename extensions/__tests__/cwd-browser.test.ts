import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DirectoryBrowser } from "../cwd-internals/directory-browser";
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
} from "./cwd-test-helpers";

describe("DirectoryBrowser", () => {
	test("initializes at an absolute path and lists sorted visible directories only", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(root, testTheme);

		expect(browser.getCurrentPath()).toBe(root);
		expect(browser.getEntryNames()).toEqual(["alpha", "zeta"]);
	});

	test("moves selection with up and down keys", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);

		expect(browser.getSelectedIndex()).toBe(0);
		browser.handleInput(KEY_DOWN);
		expect(browser.getSelectedIndex()).toBe(1);
		browser.handleInput(KEY_DOWN);
		expect(browser.getSelectedIndex()).toBe(2);
		browser.handleInput(KEY_DOWN);
		expect(browser.getSelectedIndex()).toBe(3);
		browser.handleInput(KEY_DOWN);
		expect(browser.getSelectedIndex()).toBe(3);
		browser.handleInput(KEY_UP);
		expect(browser.getSelectedIndex()).toBe(2);
	});

	test("home and end jump to first and last selectable items", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);

		browser.handleInput(KEY_END);
		expect(browser.getSelectedIndex()).toBe(3);
		browser.handleInput(KEY_HOME);
		expect(browser.getSelectedIndex()).toBe(0);
	});

	test("enter on use-this-directory selects the current path", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(root, testTheme);
		const selectedPaths: string[] = [];
		browser.onSelect = (path) => {
			selectedPaths.push(path);
		};

		browser.handleInput(KEY_ENTER);

		expect(selectedPaths).toEqual([root]);
	});

	test("enter on a subdirectory updates the current path", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(root, testTheme);

		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_ENTER);

		expect(browser.getCurrentPath()).toBe(join(root, "alpha"));
		expect(browser.getSelectedIndex()).toBe(0);
	});

	test("backspace and left go to the parent directory", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(join(root, "alpha"), testTheme);

		browser.handleInput(KEY_BACKSPACE);
		expect(browser.getCurrentPath()).toBe(root);

		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_ENTER);
		expect(browser.getCurrentPath()).toBe(join(root, "alpha"));

		browser.handleInput(KEY_LEFT);
		expect(browser.getCurrentPath()).toBe(root);
	});

	test("escape cancels the browser", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);
		let cancelled = false;
		browser.onCancel = () => {
			cancelled = true;
		};

		browser.handleInput(KEY_ESCAPE);

		expect(cancelled).toBe(true);
	});

	test("does not render a parent entry at filesystem root", () => {
		const browser = new DirectoryBrowser("/", testTheme);

		expect(browser.render(80).some((line) => line.includes(".."))).toBe(false);
	});

	test("caches render output and invalidates on state changes", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);

		const firstRender = browser.render(80);
		expect(browser.render(80)).toBe(firstRender);
		browser.handleInput(KEY_DOWN);
		expect(browser.render(80)).not.toBe(firstRender);
	});
});
