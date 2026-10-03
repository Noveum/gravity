function storageKey(userId: string): string {
  return `gravity:last-pipeline:${userId}`;
}

export function rememberPipeline(userId: string, key: string): void {
  try {
    window.localStorage.setItem(storageKey(userId), key);
  } catch (error: unknown) {
    console.info('Could not remember the last pipeline.', error);
  }
}

export function lastPipelineKey(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}
