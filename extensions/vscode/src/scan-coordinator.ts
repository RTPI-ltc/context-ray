export class LatestRequestGate {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

export interface DebouncedTrigger {
  trigger(): void;
  dispose(): void;
}

export function createDebouncedTrigger(action: () => void, delayMs: number): DebouncedTrigger {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    trigger(): void {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        action();
      }, delayMs);
    },
    dispose(): void {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
