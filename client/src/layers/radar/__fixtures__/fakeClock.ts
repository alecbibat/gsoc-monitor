import { vi } from 'vitest';

// Virtual time for the tile pipeline's tests: setTimeout/setInterval,
// Date.now and performance.now move only in advance(). Vitest's fake timers
// won't do here: they push a zero-delay timer set while timers run 1 ms into
// the future, which stalls (or, advanced, drifts) the service's paint loop
// that yields with setTimeout(0) between tiles. Real async work (zlib behind
// DecompressionStream, stream reads) keeps running on the real event loop;
// every step spins it without moving virtual time.

interface Timer {
  at: number;
  fn: () => void;
  every: number | null;
}

const realMs = () => Number(process.hrtime.bigint() / 1_000_000n);

export class FakeClock {
  now: number;
  private timers = new Map<number, Timer>();
  private nextId = 1;

  constructor(readonly start: number) {
    this.now = start;
  }

  install(): this {
    const add = (fn: () => void, ms: number | undefined, every: number | null) => {
      const id = this.nextId++;
      this.timers.set(id, { at: this.now + Math.max(0, ms ?? 0), fn, every });
      return id;
    };
    const clear = (id: number) => void this.timers.delete(id);
    vi.spyOn(Date, 'now').mockImplementation(() => this.now);
    vi.spyOn(performance, 'now').mockImplementation(() => this.now - this.start);
    vi.stubGlobal('setTimeout', (fn: () => void, ms?: number) => add(fn, ms, null));
    vi.stubGlobal('setInterval', (fn: () => void, ms?: number) => add(fn, ms, Math.max(1, ms ?? 0)));
    vi.stubGlobal('clearTimeout', clear);
    vi.stubGlobal('clearInterval', clear);
    return this;
  }

  // Let pending real work and the microtasks it queues run.
  async spin(turns = 3): Promise<void> {
    for (let i = 0; i < turns; i++) await new Promise((r) => setImmediate(r));
  }

  // Run every timer due within `ms`, in time order, then stop at now + ms.
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      await this.spin();
      let next: [number, Timer] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      const [id, t] = next;
      this.now = t.at;
      if (t.every === null) this.timers.delete(id);
      else t.at += t.every;
      t.fn();
    }
    this.now = end;
    await this.spin();
  }

  // Spin (firing timers already due, never moving time) until `cond` holds.
  async until(cond: () => boolean | Promise<boolean>, what = 'condition'): Promise<void> {
    const deadline = realMs() + 4000;
    while (!(await cond())) {
      if (realMs() > deadline) throw new Error(`timed out waiting for ${what}`);
      await this.advance(0);
    }
  }
}
