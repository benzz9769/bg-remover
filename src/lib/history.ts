/** Minimal undo/redo stack of edits (pure, no DOM). */
export class EditHistory<T> {
  private done: T[] = [];
  private undone: T[] = [];
  constructor(private readonly limit = 50) {}

  get edits(): readonly T[] {
    return this.done;
  }
  get canUndo(): boolean {
    return this.done.length > 0;
  }
  get canRedo(): boolean {
    return this.undone.length > 0;
  }
  /**
   * Add an edit. If the stack exceeds `limit`, the oldest edit is removed and
   * returned so the caller can "bake" it into its base mask (it can no longer
   * be undone, but the composed result stays identical).
   */
  push(e: T): T | undefined {
    this.done.push(e);
    this.undone = [];
    if (this.done.length > this.limit) return this.done.shift();
    return undefined;
  }
  undo(): T | undefined {
    const e = this.done.pop();
    if (e !== undefined) this.undone.push(e);
    return e;
  }
  redo(): T | undefined {
    const e = this.undone.pop();
    if (e !== undefined) this.done.push(e);
    return e;
  }
  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
