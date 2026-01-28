class Queue {
	constructor(options = {}) {
		this.concurrency = options.concurrency || 1;
		this.pending = 0;
		this.queue = [];
	}

	add(fn, options = {}) {
		return new Promise((resolve, reject) => {
			const element = {
				fn,
				priority: options.priority || 0,
				resolve,
				reject
			};
			this.queue.push(element);
			this._process();
		});
	}

	_process() {
		if (this.pending >= this.concurrency || this.queue.length === 0) {
			return;
		}

		this.pending++;
		// Sort by priority (descending)
		this.queue.sort((a, b) => b.priority - a.priority);
		const item = this.queue.shift();

		// Execute
		Promise.resolve()
			.then(() => item.fn())
			.then((result) => {
				item.resolve(result);
			})
			.catch((err) => {
				item.reject(err);
			})
			.finally(() => {
				this.pending--;
				this._process();
			});
	}

	get size() {
		return this.queue.length;
	}

	get isPaused() {
		return false; // Not implemented
	}
}

module.exports = Queue;
