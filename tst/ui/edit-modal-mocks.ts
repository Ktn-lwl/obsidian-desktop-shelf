import type { App } from 'obsidian';
import { vi } from 'vitest';
import { TestElement } from './view-mocks';

export const rows: UiSetting[] = [];
export class UiModal {
	contentEl = new TestElement();
	title = '';
	close = vi.fn();
	open = vi.fn();
	constructor(readonly app: App) {}
	setTitle(title: string): void {
		this.title = title;
	}
}
export class UiSetting {
	settingEl: TestElement;
	name = '';
	description = '';
	text?: UiText;
	buttons: UiButton[] = [];
	constructor(parent: TestElement) {
		this.settingEl = parent.createDiv();
		rows.push(this);
	}
	setName(name: string): this {
		this.name = name;
		return this;
	}
	setDesc(description: string): this {
		this.description = description;
		return this;
	}
	addText(callback: (text: UiText) => unknown): this {
		this.text = new UiText();
		callback(this.text);
		return this;
	}
	addSearch(callback: (text: UiText) => unknown): this {
		return this.addText(callback);
	}
	addButton(callback: (button: UiButton) => unknown): this {
		const button = new UiButton();
		this.buttons.push(button);
		callback(button);
		return this;
	}
}
class UiText {
	inputEl = { inputMode: '', disabled: false };
	private value = '';
	private change?: (value: string) => void;
	setValue(value: string): this {
		this.value = value;
		return this;
	}
	getValue(): string {
		return this.value;
	}
	setPlaceholder(): this {
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.inputEl.disabled = disabled;
		return this;
	}
	onChange(change: (value: string) => void): this {
		this.change = change;
		return this;
	}
	simulateInput(value: string): void {
		this.value = value;
		this.change?.(value);
	}
}
class UiButton {
	buttonText = '';
	disabled = false;
	private action?: () => void;
	setButtonText(text: string): this {
		this.buttonText = text;
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}
	setCta(): this {
		return this;
	}
	setTooltip(): this {
		return this;
	}
	onClick(action: () => void): this {
		this.action = action;
		return this;
	}
	click(): void {
		if (!this.disabled) this.action?.();
	}
}
