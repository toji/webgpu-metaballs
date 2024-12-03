import { vec3, mat4 } from 'gl-matrix';
import { ProjectionUniformsSize, ViewUniformsSize, BIND_GROUP, ATTRIB_MAP } from './shaders/common.js';

// Manages all the information needed to render a single view of the scene.
export class WebGPUView {
  constructor(renderer) {
    this.renderer = renderer;

    // Storage for global uniforms.
    // These can either be used individually or as a uniform buffer.
    this.defaultFov = Math.PI * 0.5;
    this.uniformsArray = new Float32Array(16 + 16 + 16 + 4 + 4);
    this.projectionMatrix = new Float32Array(this.uniformsArray.buffer, 0, 16);
    this.inverseProjectionMatrix = new Float32Array(this.uniformsArray.buffer, 16 * 4, 16);
    this.outputSize = new Float32Array(this.uniformsArray.buffer, 32 * 4, 2);
    this.zRange = new Float32Array(this.uniformsArray.buffer, 34 * 4, 2);

    this.zRange[0] = 0.2; // Near
    this.zRange[1] = 100.0; // Far

    this.viewMatrix = new Float32Array(this.uniformsArray.buffer, 36 * 4, 16);
    this.cameraPosition = new Float32Array(this.uniformsArray.buffer, 52 * 4, 3);
    this.timeArray = new Float32Array(this.uniformsArray.buffer, 55 * 4, 1);

    this.projectionBuffer = renderer.device.createBuffer({
      size: ProjectionUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
  
    this.viewBuffer = renderer.device.createBuffer({
      size: ViewUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.bindGroup = renderer.device.createBindGroup({
      layout: renderer.bindGroupLayouts.frame,
      entries: [{
        binding: 0,
        resource: {
          buffer: this.projectionBuffer,
        },
      }, {
        binding: 1,
        resource: {
          buffer: this.viewBuffer,
        },
      }, {
        binding: 2,
        resource: {
          buffer: renderer.lightsBuffer,
        },
      }, {
        binding: 3,
        resource: {
          buffer: renderer.clusteredLights.clusterLightsBuffer,
        }
      }],
    });
  }

  updateMatrices(camera) {
    this.outputSize[0] = this.renderer.canvas.width;
    this.outputSize[1] = this.renderer.canvas.height;

    const device = this.renderer.device;
    mat4.perspectiveZO(this.projectionMatrix, this.defaultFov, this.outputSize[0] / this.outputSize[1], this.zRange[0], this.zRange[1]);
    mat4.invert(this.inverseProjectionMatrix, this.projectionMatrix);
    mat4.copy(this.viewMatrix, camera.viewMatrix);
    vec3.copy(this.cameraPosition, camera.position);

    device.queue.writeBuffer(this.projectionBuffer, 0, this.uniformsArray.buffer, 0, ProjectionUniformsSize);
    device.queue.writeBuffer(this.viewBuffer, 0, this.uniformsArray.buffer, ProjectionUniformsSize, ViewUniformsSize);
  }

  updateMatricesForXR(xrView) {
    const device = this.renderer.device;
    mat4.copy(this.projectionMatrix, xrView.projectionMatrix);
    mat4.invert(this.inverseProjectionMatrix, this.projectionMatrix);
    mat4.copy(this.viewMatrix, xrView.transform.inverse.matrix);
    vec3.copy(this.cameraPosition, [
      xrView.transform.position.x,
      xrView.transform.position.y,
      xrView.transform.position.z
    ]);

    device.queue.writeBuffer(this.projectionBuffer, 0, this.uniformsArray.buffer, 0, ProjectionUniformsSize);
    device.queue.writeBuffer(this.viewBuffer, 0, this.uniformsArray.buffer, ProjectionUniformsSize, ViewUniformsSize);
  }
}