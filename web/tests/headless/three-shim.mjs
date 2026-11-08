/* Headless shim for three.js: everything real except WebGLRenderer. */

import * as REAL from '../../vendor/three.module.min.js';

const {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Fog,
  FrontSide,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  Clock,
} = REAL;

export {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Fog,
  FrontSide,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  Clock,
};

export class WebGLRenderer {
  constructor(params = {}) {
    this.domElement = params.canvas || {};
    this.shadowMap = { enabled: false, type: 0 };
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.renders = 0;
  }

  setPixelRatio() {}
  setSize() {}
  setClearColor() {}
  getPixelRatio() { return 1; }
  compile() {}
  dispose() {}

  render(scene, camera) {
    this.renders++;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
  }
}
