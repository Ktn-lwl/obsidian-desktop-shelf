export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Refresh cancelled', 'AbortError');
}

export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
	throwIfAborted(signal);
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			window.clearTimeout(timer);
			reject(new DOMException('Refresh cancelled', 'AbortError'));
		};
		const timer = window.setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, milliseconds);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
