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
  CanvasTexture,
  IcosahedronGeometry,
  RingGeometry,
  TorusGeometry,
  SRGBColorSpace,
  RepeatWrapping,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  Clock,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
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
  CanvasTexture,
  IcosahedronGeometry,
  RingGeometry,
  TorusGeometry,
  SRGBColorSpace,
  RepeatWrapping,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  Clock,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
};

export class WebGLRenderer {
  constructor(params = {}) {
    this.domElement = params.canvas || {};
    this.shadowMap = { enabled: false, type: 0 };
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.renders = 0;
    // OutputPass reads these; three.js expects real colour-space strings.
    this.outputColorSpace = 'srgb';
    this.drawCalls = 0;
    this.info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 }, programs: [] };
    this.capabilities = { isWebGL2: true, maxTextures: 16, getMaxAnisotropy: () => 1 };
    this.properties = { get: () => ({}) };
  }

  setPixelRatio() {}
  setSize(w, h) { this._w = w; this._h = h; }
  getSize(target) {
    target = target || { width: 0, height: 0 };
    target.width = this._w || 1280;
    target.height = this._h || 720;
    return target;
  }
  setClearColor() {}
  setRenderTarget() {}
  getRenderTarget() { return null; }
  clearDepth() {}
  setScissorTest() {}
  setViewport() {}
  setScissor() {}
  getPixelRatio() { return 1; }
  clear() {}
  clearColor() {}
  clearDepth() {}
  getClearColor(target) { return (target || { r: 0, g: 0, b: 0, a: 1 }); }
  getClearAlpha() { return 1; }
  setClearAlpha() {}
  getPixelRatio() { return 1; }
  getRenderTarget() { return null; }
  setRenderTarget() {}
  compile() {}
  renderBufferDirect() {}
  initTexture() {}
  resetState() {}
  compile() {}
  dispose() {}

  render(scene, camera) {
    this.renders++;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
  }
}
