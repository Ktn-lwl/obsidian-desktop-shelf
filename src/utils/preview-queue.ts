let queue: Promise<unknown> = Promise.resolve();

export function enqueuePreview<T>(work: () => Promise<T>): Promise<T> {
	const result = queue.then(work);
	queue = result.catch(() => {});
	return result;
}

export async function waitForPreviews(): Promise<void> {
	await queue;
}
