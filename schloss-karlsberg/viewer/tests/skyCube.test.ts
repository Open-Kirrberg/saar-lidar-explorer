import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SKY_CUBE_FACES_PER_FRAME, SKY_CUBE_SIZE, smallUniformChange, uniformNumbers, uniformSignature } from '../src/postMath.ts';

describe('sky cube cache keys (KB-I65 wave 7)', () => {
  const state = (sunY: number, scale = 1) => [new THREE.Vector3(0.3, sunY, -0.9), new THREE.Color(0.5, 0.6, 0.7), scale, true, new THREE.Matrix4(), null];

  it('flattens vectors, colours, matrices, booleans; other objects are NaN', () => {
    const n = uniformNumbers(state(0.2));
    expect(n.length).toBe(4 + 3 + 1 + 1 + 16 + 1);
    expect(n.slice(0, 3)).toEqual([0.3, 0.2, -0.9]);
    expect(Number.isNaN(n[n.length - 1])).toBe(true);
  });

  it('equal states give equal signatures; float noise below 5 digits does not refresh the cube', () => {
    expect(uniformSignature(state(0.2))).toBe(uniformSignature(state(0.2)));
    expect(uniformSignature(state(0.2))).toBe(uniformSignature(state(0.2 + 1e-9)));
    expect(uniformSignature(state(0.2))).not.toBe(uniformSignature(state(0.21)));
  });

  it('a running clock is a small change; an hour jump or exposure switch is not', () => {
    expect(smallUniformChange(uniformNumbers(state(0.2)), uniformNumbers(state(0.205)))).toBe(true);
    expect(smallUniformChange(uniformNumbers(state(0.2)), uniformNumbers(state(0.5)))).toBe(false);
    expect(smallUniformChange(uniformNumbers(state(0.2, 1)), uniformNumbers(state(0.2, 4)))).toBe(false);
    expect(smallUniformChange([1, 2], [1, 2, 3])).toBe(false);
  });

  it('refreshes within a few frames at a bounded size', () => {
    expect(6 / SKY_CUBE_FACES_PER_FRAME).toBeLessThanOrEqual(6);
    expect(SKY_CUBE_SIZE).toBeLessThanOrEqual(1024);
  });
});
