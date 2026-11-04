// Repository interface; in-memory implementation (Postgres adapter plugs in behind the same interface).
export interface Repo<T extends { id: string }> { all(): T[]; get(id: string): T | undefined; put(x: T): T }
export function memoryRepo<T extends { id: string }>(seed: T[] = []): Repo<T> {
  const m = new Map(seed.map((x) => [x.id, x]));
  return { all: () => [...m.values()], get: (id) => m.get(id), put: (x) => (m.set(x.id, x), x) };
}
