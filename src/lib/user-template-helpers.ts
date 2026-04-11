export function removeTemplateOptimistic<T extends { id: string }>(
  list: T[],
  id: string
): { next: T[]; rollback: (current: T[]) => T[] } {
  const index = list.findIndex((t) => t.id === id);
  if (index === -1) {
    return { next: list, rollback: (current) => current };
  }
  const removed = list[index];
  const next = list.filter((t) => t.id !== id);
  return {
    next,
    rollback: (current) => {
      if (current.some((t) => t.id === id)) return current;
      const result = [...current];
      result.splice(Math.min(index, result.length), 0, removed);
      return result;
    },
  };
}
