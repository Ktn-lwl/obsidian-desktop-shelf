import { vi } from 'vitest';
import type {
	App as ObsidianApp,
	ButtonComponent as ObsidianButtonComponent,
	Modal as ObsidianModal,
	TextComponent as ObsidianTextComponent,
} from 'obsidian';

/**
 * Obsidian extends Array.prototype with .last().
 *
 * obsidian.d.ts declares this method, but it does not exist in the normal
 * JavaScript runtime used by Vitest.
 */
if (!Array.prototype.last) {
	Array.prototype.last = function <T>(this: T[]): T | undefined {
		return this[this.length - 1];
	};
}

/**
 * Minimal DOM-like element used by the component mocks.
 * This deliberately implements only the behavior currently needed by tests.
 */
export class FakeEl {
	value = '';
	disabled = false;
	placeholder = '';
	innerText = '';

	private listeners = new Map<string, Set<(event: any) => void>>();

	addEventListener(type: string, callback: (event: any) => void) {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set());
		}

		this.listeners.get(type)!.add(callback);
	}

	removeEventListener(type: string, callback: (event: any) => void) {
		this.listeners.get(type)?.delete(callback);
	}

	dispatchEvent(event: { type: string; [key: string]: any }) {
		this.listeners.get(event.type)?.forEach((callback) => callback(event));
		return true;
	}
}

export function keyboardEvent(key: string) {
	return {
		type: 'keydown',
		key,
		preventDefault: vi.fn(),
	};
}

/**
 * Runtime App mock.
 *
 * The actual object can remain empty because tests generally don't need
 * App's keymap/workspace/vault/etc. The exported constructor below is typed
 * as constructing the real Obsidian App, which keeps consumers compatible
 * with constructors expecting `import('obsidian').App`.
 */
class MockApp {}

/**
 * IMPORTANT:
 *
 * At runtime this is MockApp.
 * At compile time `new App()` is an ObsidianApp.
 *
 * This keeps the type escape hatch here in the mock instead of requiring
 * `as unknown as App` throughout the tests.
 */
export const App = MockApp as unknown as {
	new (): ObsidianApp;
};

/**
 * Notice is both constructable and inspectable as a Vitest spy.
 */
export const Notice = vi.fn(function (this: { message: string }, message: string) {
	this.message = message;
});

/**
 * Modal
 */
export class Modal {
	static instances: Modal[] = [];

	app: ObsidianApp;
	contentEl = new FakeEl();

	open = vi.fn();
	close = vi.fn();

	constructor(app: ObsidianApp) {
		this.app = app;
		Modal.instances.push(this);
	}

	onClose(): void {}
}

/**
 * TextComponent
 *
 * Mirrors the important Obsidian behavior:
 * - setValue() updates the value
 * - onChange() responds to an input event
 * - setValue() itself does NOT invoke onChange()
 */
export class TextComponent {
	static instances: TextComponent[] = [];

	inputEl = new FakeEl();

	private changeHandler: ((value: string) => void) | null = null;

	constructor() {
		TextComponent.instances.push(this);

		this.inputEl.addEventListener('input', () => {
			this.changeHandler?.(this.inputEl.value);
		});
	}

	onChange(callback: (value: string) => void) {
		this.changeHandler = callback;
		return this;
	}

	setPlaceholder(text: string) {
		this.inputEl.placeholder = text;
		return this;
	}

	setValue(value: string) {
		this.inputEl.value = value;
		return this;
	}

	getValue() {
		return this.inputEl.value;
	}

	/**
	 * Test helper: simulate actual user input.
	 */
	simulateInput(value: string) {
		this.setValue(value);
		this.inputEl.dispatchEvent({ type: 'input' });
	}
}

/**
 * ButtonComponent
 */
export class ButtonComponent {
	static instances: ButtonComponent[] = [];

	buttonEl = new FakeEl();
	buttonText = '';

	private clickHandler: (() => void) | null = null;

	constructor() {
		ButtonComponent.instances.push(this);

		this.buttonEl.addEventListener('click', () => {
			if (!this.buttonEl.disabled) {
				this.clickHandler?.();
			}
		});
	}

	setButtonText(text: string) {
		this.buttonText = text;
		this.buttonEl.innerText = text;
		return this;
	}

	setDisabled(disabled: boolean) {
		this.buttonEl.disabled = disabled;
		return this;
	}

	onClick(callback: () => void) {
		this.clickHandler = callback;
		return this;
	}

	get disabled() {
		return this.buttonEl.disabled;
	}

	/**
	 * Test helper: simulate a user click.
	 */
	click() {
		this.buttonEl.dispatchEvent({ type: 'click' });
	}
}

/**
 * Setting
 */
export class Setting {
	constructor(_containerEl: unknown) {}

	addText(callback: (text: TextComponent) => void) {
		callback(new TextComponent());
		return this;
	}

	addButton(callback: (button: ButtonComponent) => void) {
		callback(new ButtonComponent());
		return this;
	}
}

/**
 * PluginSettingTab
 */
export class PluginSettingTab {
	app: ObsidianApp;
	plugin: unknown;
	containerEl = new FakeEl();

	constructor(app: ObsidianApp, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
}

/**
 * AbstractInputSuggest
 */
export class AbstractInputSuggest<T> {
	app: ObsidianApp;
	textInputEl: unknown;

	open = vi.fn();
	close = vi.fn();

	constructor(app: ObsidianApp, textInputEl: unknown) {
		this.app = app;
		this.textInputEl = textInputEl;
	}
}

/**
 * Optional convenience helper.
 *
 * Usually unnecessary now because `new App()` already has the correct
 * compile-time type.
 */
export function createApp(): ObsidianApp {
	return new App();
}

/**
 * Compile-time sanity checks.
 *
 * These produce no runtime behavior but make accidental changes to the
 * mock's public typing easier to catch.
 */
const _appTypeCheck: ObsidianApp = new App();
void _appTypeCheck;

type _ModalCompatibility = ObsidianModal;
type _TextCompatibility = ObsidianTextComponent;
type _ButtonCompatibility = ObsidianButtonComponent;
