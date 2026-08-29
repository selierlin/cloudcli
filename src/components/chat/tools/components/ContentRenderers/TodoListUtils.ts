export type TodoItem = {
  id?: string;
  content: string;
  status: string;
  priority?: string;
  activeForm?: string;
};

/** Converts Claude and Codex todo item shapes into the renderer's common shape. */
export function normalizeTodoItems(items: unknown): TodoItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((value) => {
    if (typeof value !== 'object' || value === null) {
      return [];
    }

    const item = value as Record<string, unknown>;
    const content = typeof item.content === 'string'
      ? item.content
      : typeof item.text === 'string'
        ? item.text
        : '';
    if (!content) {
      return [];
    }

    const status = typeof item.status === 'string'
      ? item.status
      : item.completed === true
        ? 'completed'
        : 'pending';

    return [{
      content,
      status,
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      ...(typeof item.activeForm === 'string' ? { activeForm: item.activeForm } : {}),
    }];
  });
}
