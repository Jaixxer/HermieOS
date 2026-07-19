export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickFn: () => Promise<void>;

  constructor(tickFn: () => Promise<void>) {
    this.tickFn = tickFn;
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single tick. Skips if a previous tick is still running. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tickFn();
    } finally {
      this.running = false;
    }
  }

  get isRunning(): boolean {
    return this.running;
  }
}
