type MoneyOperation = { type: 'income' | 'expense'; amount: number; date: string }

// Future-dated entries have not changed today's available money yet.
export function bookBalance(operations: MoneyOperation[], asOf: string): number {
  return operations
    .filter((operation) => operation.date <= asOf)
    .reduce((cents, operation) => cents + Math.round(operation.amount * 100) *
      (operation.type === 'income' ? 1 : -1), 0) / 100
}
