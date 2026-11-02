/**
 * Serialised "build for the latest key" helper (pure, no three.js).
 *
 * `ensure()` runs at most one build at a time and only settles once the last finished build
 * matches the key `wanted()` returns *now*. A key change while a build is in flight (new radius,
 * new data generation …) triggers a follow-up build instead of being overwritten by the stale
 * result. `wanted()` returning null means "nothing to build".
 */
export class LatestBuild<K> {
  private built: K | null = null;
  private pending: Promise<void> | null = null;

  constructor(
    private readonly wanted: () => K | null,
    private readonly build: (key: K) => Promise<void>,
  ) {}

  /** Key of the last completed build (null if none). */
  get builtKey(): K | null {
    return this.built;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  ensure(): Promise<void> {
    if (!this.pending) {
      this.pending = this.run().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async run(): Promise<void> {
    for (;;) {
      const key = this.wanted();
      if (key === null || key === this.built) return;
      await this.build(key);
      this.built = key;
    }
  }
}
