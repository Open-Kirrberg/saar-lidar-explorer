import { describe, expect, it } from 'vitest';
import { LatestBuild } from '../src/terrain/latestBuild';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('LatestBuild', () => {
  it('builds once for an unchanged key', async () => {
    const built: string[] = [];
    const lb = new LatestBuild(
      () => 'a',
      async (k) => {
        built.push(k);
      },
    );
    await lb.ensure();
    await lb.ensure();
    expect(built).toEqual(['a']);
    expect(lb.builtKey).toBe('a');
  });

  it('does nothing while wanted() is null', async () => {
    let calls = 0;
    const lb = new LatestBuild<string>(
      () => null,
      async () => {
        calls++;
      },
    );
    await lb.ensure();
    expect(calls).toBe(0);
  });

  it('a key bump during an in-flight build triggers a rebuild (R0.1 race)', async () => {
    let gen = 0;
    const gates: Array<ReturnType<typeof deferred>> = [];
    const built: string[] = [];
    const lb = new LatestBuild(
      () => `15@${gen}`,
      async (k) => {
        const d = deferred();
        gates.push(d);
        await d.promise;
        built.push(k);
      },
    );
    const first = lb.ensure(); // starts build for 15@0 (half-loaded mosaic)
    gen++; // load() finished → mosaic changed
    const second = lb.ensure(); // joins the in-flight run
    expect(second).toBe(first);
    gates[0].resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(gates.length).toBe(2); // follow-up build started
    gates[1].resolve();
    await second;
    expect(built).toEqual(['15@0', '15@1']);
    expect(lb.builtKey).toBe('15@1');
    expect(lb.busy).toBe(false);
  });

  it('collapses several key changes during one build into one follow-up', async () => {
    let radius = 5;
    const built: number[] = [];
    let release!: () => void;
    const lb = new LatestBuild(
      () => radius,
      async (k) => {
        if (built.length === 0) await new Promise<void>((r) => (release = r));
        built.push(k);
      },
    );
    const p = lb.ensure();
    radius = 10;
    void lb.ensure();
    radius = 20;
    void lb.ensure();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await p;
    expect(built).toEqual([5, 20]);
  });

  it('propagates build errors and allows a retry', async () => {
    let fail = true;
    const lb = new LatestBuild(
      () => 'k',
      async () => {
        if (fail) throw new Error('boom');
      },
    );
    await expect(lb.ensure()).rejects.toThrow('boom');
    expect(lb.builtKey).toBeNull();
    fail = false;
    await lb.ensure();
    expect(lb.builtKey).toBe('k');
  });
});
