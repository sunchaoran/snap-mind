export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Processing timed out after ${ms}ms`)),
      ms,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export async function timed<T>(
  key: string,
  timings: Record<string, number>,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    timings[key] = Date.now() - start;
  }
}
