interface VersionedRecord {
  id: string;
  version: number;
}

export class LocalRecordVersions {
  private saved = new Map<string, { from: number; record: VersionedRecord }>();

  clear() {
    this.saved.clear();
  }

  remember<T extends VersionedRecord>(
    scope: string,
    previousVersion: number,
    record: T,
  ) {
    if (record.version !== previousVersion + 1) return;
    const key = `${scope}/${record.id}`;
    const previous = this.saved.get(key);
    this.saved.set(key, {
      from:
        previous?.record.version === previousVersion
          ? previous.from
          : previousVersion,
      record,
    });
  }

  current<T extends VersionedRecord>(scope: string, original: T): T {
    const saved = this.saved.get(`${scope}/${original.id}`);
    return saved &&
      saved.from <= original.version &&
      saved.record.version > original.version
      ? { ...original, ...saved.record }
      : original;
  }
}
