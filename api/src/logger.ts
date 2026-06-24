export function logInfo(step: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', step, ...fields }));
}

export function logError(step: string, fields: Record<string, unknown>, error: unknown): void {
  console.error(JSON.stringify({
    level: 'error',
    step,
    ...fields,
    error: formatError(error)
  }));
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
