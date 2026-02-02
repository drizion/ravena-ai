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
				reject,
				timestamp: Date.now()
			};
			this._insertSorted(element);
			this._process();
		});
	}

	addAt(fn, index, options = {}) {
		return new Promise((resolve, reject) => {
			const element = {
				fn,
				priority: options.priority || 0,
				resolve,
				reject,
				timestamp: Date.now()
			};
			if (index < 0) index = 0;
			if (index >= this.queue.length) {
				this.queue.push(element);
			} else {
				this.queue.splice(index, 0, element);
			}
			this._process();
		});
	}

	_insertSorted(element) {
		let added = false;
		for (let i = 0; i < this.queue.length; i++) {
			const item = this.queue[i];
			// Higher priority first
			if (element.priority > item.priority) {
				this.queue.splice(i, 0, element);
				added = true;
				break;
			}
			// Same priority, older timestamp first (FIFO)
			else if (element.priority === item.priority && element.timestamp < item.timestamp) {
				this.queue.splice(i, 0, element);
				added = true;
				break;
			}
		}
		if (!added) {
			this.queue.push(element);
		}
	}

	_process() {
		if (this.pending >= this.concurrency || this.queue.length === 0) {
			return;
		}

		this.pending++;
		// Sort is removed from here to allow position-based insertions (addAt)
		// and efficient stable sorting via _insertSorted
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

	getStats() {
		const stats = {};
		for (const item of this.queue) {
			const p = item.priority.toString();
			stats[p] = (stats[p] || 0) + 1;
		}
		return stats;
	}

	get size() {
		return this.queue.length;
	}

	get isPaused() {
		return false; // Not implemented
	}
}

module.exports = Queue;
