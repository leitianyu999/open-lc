export class TaskQueue {
  private running = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly concurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }

    this.running += 1
    try {
      return await task()
    } finally {
      this.running -= 1
      const next = this.queue.shift()
      if (next) next()
    }
  }
}
