import { BackSide, GLSL3, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { FOG_COLOR } from './TerrainMaterial';

/** Simple gradient sky dome that follows the camera; horizon colour matches the terrain haze. */
export function createSky(radius = 30000): Mesh {
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uHorizon: { value: FOG_COLOR.clone() },
      uZenith: { value: new Vector3(0.36, 0.53, 0.74) },
      uGround: { value: new Vector3(0.6, 0.64, 0.66) },
    },
    vertexShader: /* glsl */ `
      out vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uGround;
      in vec3 vDir;
      out vec4 fragColor;
      void main() {
        float y = normalize(vDir).y;
        vec3 c = y >= 0.0 ? mix(uHorizon, uZenith, pow(y, 0.6)) : mix(uHorizon, uGround, pow(-y, 0.5));
        fragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new Mesh(new SphereGeometry(radius, 32, 16), material);
  sky.name = 'Sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}
