import { memo, useMemo } from 'react';

import TodoList from '@/modules/chat/tools/ContentRenderers/TodoList';
import type { TodoItem } from '@/shared/types';

/**
 * Converts Claude and Codex todo item shapes into the renderer's common shape.
 * Claude emits { content, status } while Codex emits { text, completed: boolean };
 * the renderer needs content strings plus a status string either way.
 */
const normalizeTodoItems = (items: unknown): TodoItem[] => {
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
};

/**
 * Renders a todo list
 * Used by: TodoWrite, TodoRead, Codex TodoList
 *
 * Rendered by chat's ToolRenderer as the content of a todo tool result.
 */
export const TodoListContent = memo(
  ({
    todos,
    isResult = false,
  }: {
    todos: unknown;
    isResult?: boolean;
  }) => {
    const safeTodos = useMemo<TodoItem[]>(() => normalizeTodoItems(todos), [todos]);

    if (safeTodos.length === 0) {
      return null;
    }

    return <TodoList todos={safeTodos} isResult={isResult} />;
  }
);
