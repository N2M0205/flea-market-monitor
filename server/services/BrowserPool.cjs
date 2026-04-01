'use strict';

/**
 * ブラウザ同時起動数を制限するセマフォ
 *
 * 全スクレイパーで共有し、同時に開くブラウザを MAX_BROWSERS 以下に抑える。
 * acquire() → ブラウザ起動 → finally で release() のパターンで使う。
 */

const MAX_BROWSERS = 4;
const ACQUIRE_TIMEOUT_MS = 60000;

class BrowserPool {
  constructor() {
    this._running = 0;
    this._queue = [];
  }

  acquire() {
    return new Promise((resolve, reject) => {
      if (this._running < MAX_BROWSERS) {
        this._running++;
        return resolve();
      }

      const timer = setTimeout(() => {
        const idx = this._queue.indexOf(entry);
        if (idx !== -1) this._queue.splice(idx, 1);
        reject(new Error(`BrowserPool acquire timeout (${ACQUIRE_TIMEOUT_MS}ms) — ${this._running} browsers running`));
      }, ACQUIRE_TIMEOUT_MS);

      const entry = { resolve, timer };
      this._queue.push(entry);
    });
  }

  release() {
    if (this._queue.length > 0) {
      const entry = this._queue.shift();
      clearTimeout(entry.timer);
      entry.resolve();
      // _running stays the same — slot transferred to the waiter
    } else if (this._running > 0) {
      this._running--;
    }
  }

  get stats() {
    return { running: this._running, waiting: this._queue.length, max: MAX_BROWSERS };
  }
}

module.exports = new BrowserPool();
