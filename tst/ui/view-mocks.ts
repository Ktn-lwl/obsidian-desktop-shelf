interface ElementOptions {
	text?: string;
	cls?: string;
	attr?: Record<string, string>;
	value?: string;
}

/** Small DOM/component harness for testing view updates without an Obsidian runtime. */
export class TestElement {
	children: TestElement[] & { item(index: number): TestElement | null };
	parent?: TestElement;
	text = '';
	value = '';
	hidden = false;
	disabled = false;
	open = false;
	classes = new Set<string>();
	attributes: Record<string, string> = {};
	private listeners = new Map<string, Set<() => void>>();
	constructor(readonly tag = 'div') {
		this.children = Object.assign([] as TestElement[], {
			item: (index: number) => this.children[index] ?? null,
		});
	}
	createEl(tag: string, options: ElementOptions = {}): TestElement {
		return this.makeElement(tag, options);
	}
	private makeElement(tag: string, options: ElementOptions): TestElement {
		const el = new TestElement(tag);
		el.text = options.text ?? '';
		el.value = options.value ?? '';
		el.attributes = options.attr ?? {};
		if (options.cls) el.addClass(options.cls);
		this.appendChild(el);
		return el;
	}
	createDiv(options = {}): TestElement {
		return this.makeElement('div', options);
	}
	createSpan(options = {}): TestElement {
		return this.makeElement('span', options);
	}
	addClass(value: string): void {
		this.classes.add(value);
	}
	setText(value: string): void {
		this.text = value;
	}
	empty(): void {
		for (const child of [...this.children]) child.remove();
	}
	remove(): void {
		if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
		this.parent = undefined;
	}
	appendChild(el: TestElement): void {
		el.remove();
		this.children.push(el);
		el.parent = this;
	}
	insertBefore(el: TestElement, target: TestElement | null): void {
		el.remove();
		this.children.splice(target ? this.children.indexOf(target) : this.children.length, 0, el);
		el.parent = this;
	}
	querySelector(tag: string): TestElement | undefined {
		return this.all().find((el) => el.tag === tag);
	}
	all(): TestElement[] {
		return this.children.flatMap((el) => [el, ...el.all()]);
	}
	focus(): void {}
	getContext(): object {
		return {};
	}
	addEventListener(type: string, callback: () => void): void {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)!.add(callback);
	}
	removeEventListener(type: string, callback: () => void): void {
		this.listeners.get(type)?.delete(callback);
	}
	fire(type: string): void {
		if (!this.disabled) this.listeners.get(type)?.forEach((fn) => fn());
	}
}

export class TestComponent {
	private cleanups: (() => void)[] = [];
	private childComponents = new Set<TestComponent>();
	register(fn: () => void): void {
		this.cleanups.push(fn);
	}
	registerDomEvent(el: TestElement, type: string, fn: () => void): void {
		el.addEventListener(type, fn);
		this.register(() => el.removeEventListener(type, fn));
	}
	addChild(child: TestComponent): void {
		this.childComponents.add(child);
		child.onload();
	}
	removeChild(child: TestComponent): void {
		this.childComponents.delete(child);
		child.unload();
	}
	onload(): void {}
	onunload(): void {}
	unload(): void {
		this.onunload();
		this.cleanups.splice(0).forEach((fn) => fn());
		for (const child of this.childComponents) child.unload();
		this.childComponents.clear();
	}
}

export class TestItemView extends TestComponent {
	contentEl = new TestElement();
	app = {};
	setState(): Promise<void> {
		return Promise.resolve();
	}
}
