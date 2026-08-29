import { memo, useMemo } from 'react';
import TodoList from './TodoList';
import { normalizeTodoItems } from './TodoListUtils';

/**
 * Renders a todo list
 * Used by: TodoWrite, TodoRead, Codex TodoList
 */
export const TodoListContent = memo(
  ({
    todos,
    isResult = false,
  }: {
    todos: unknown;
    isResult?: boolean;
  }) => {
    const safeTodos = useMemo(() => normalizeTodoItems(todos), [todos]);

    if (safeTodos.length === 0) {
      return null;
    }

    return <TodoList todos={safeTodos} isResult={isResult} />;
  }
);
