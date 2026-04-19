export function deepCopy<T>(value: T): T {
  if (typeIs(value, 'table')) {
    const cloned = {} as Record<string | number, unknown>;
    for (const [k, v] of pairs(value as never)) {
      cloned[k as string | number] = deepCopy(v as never);
    }
    return cloned as T;
  }
  return value;
}

export function reconcile<T>(target: T, template: T): void {
  if (!typeIs(target, 'table') || !typeIs(template, 'table')) {
    return;
  }

  for (const [k, v] of pairs(template as never)) {
    const tableTarget = target as unknown as Record<string | number, unknown>;
    const existing = tableTarget[k as string | number];
    if (existing === undefined) {
      tableTarget[k as string | number] = deepCopy(v as never);
      continue;
    }
    reconcile(existing as never, v as never);
  }
}

export function nowSeconds(): number {
  return os.time();
}

export function randomSessionId(): string {
  return `${math.floor(os.clock() * 1000)}-${math.random(1, 1_000_000_000)}`;
}
