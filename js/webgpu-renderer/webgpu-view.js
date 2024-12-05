import { vec3, mat4 } from 'gl-matrix';
import { ProjectionUniformsSize, ViewUniformsSize, BIND_GROUP, ATTRIB_MAP } from './shaders/common.js';
import { ClusteredLightManager } from './clustered-lights.js';

// Manages all the information needed to render a single view of the scene.
let NEXT_VIEW_ID = 0;
export class WebGPUView {
  constructor(renderer) {
    this.id = NEXT_VIEW_ID++;
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
      label: `Projection, view.id:${this.id}`,
      size: ProjectionUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.viewBuffer = renderer.device.createBuffer({
      label: `View, view.id:${this.id}`,
      size: ViewUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.clusteredLights = new ClusteredLightManager(renderer, this);

    this.bindGroup = renderer.device.createBindGroup({
      label: `Frame, view.id:${this.id}`,
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
          buffer: this.clusteredLights.clusterLightsBuffer,
        }
      }],
    });

    this.msaaTexture = null;
    this.msaaTextureView = null;
    this.depthTexture = null;
    this.depthTextureView = null;
  }

  getMsaaTextureView(colorTexture, sampleCount) {
    if (!this.msaaTexture || this.msaaTexture?.sampleCount != sampleCount,
        this.msaaTexture?.format != colorTexture.format ||
        this.msaaTexture?.width != colorTexture.width ||
        this.msaaTexture?.height != colorTexture.height) {
      // Explicitly destroying previous textures when resizing helps avoid
      // Out of Memory errors on the GPU.
      if (this.msaaTexture) { this.msaaTexture.destroy(); }
      this.msaaTexture = this.renderer.device.createTexture({
        label: `MSAA, view.id:${this.id}`,
        size: { width: colorTexture.width, height: colorTexture.height },
        sampleCount,
        format: colorTexture.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.msaaTextureView = this.msaaTexture.createView();
    }
    return this.msaaTextureView;
  }

  getDepthTextureView(colorTexture, format, sampleCount) {
    if (!this.depthTexture || this.depthTexture?.sampleCount != sampleCount,
        this.depthTexture?.format != format ||
        this.depthTexture?.width != colorTexture.width ||
        this.depthTexture?.height != colorTexture.height) {
      // Explicitly destroying previous textures when resizing helps avoid
      // Out of Memory errors on the GPU.
      if (this.depthTexture) { this.depthTexture.destroy(); }
      this.depthTexture = this.renderer.device.createTexture({
        label: `Depth, view.id:${this.id}`,
        size: { width: colorTexture.width, height: colorTexture.height },
        sampleCount,
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.depthTextureView = this.depthTexture.createView();
    }
    return this.depthTextureView;
  }

  updateMatrices(timestamp, camera) {
    this.outputSize[0] = this.renderer.canvas.width;
    this.outputSize[1] = this.renderer.canvas.height;

    this.zRange[0] = 0.2; // Near
    this.zRange[1] = 100.0; // Far

    this.timeArray[0] = timestamp;

    const device = this.renderer.device;
    mat4.perspectiveZO(this.projectionMatrix, this.defaultFov, this.outputSize[0] / this.outputSize[1], this.zRange[0], this.zRange[1]);
    mat4.invert(this.inverseProjectionMatrix, this.projectionMatrix);
    mat4.copy(this.viewMatrix, camera.viewMatrix);
    vec3.copy(this.cameraPosition, camera.position);

    device.queue.writeBuffer(this.projectionBuffer, 0, this.uniformsArray.buffer, 0, ProjectionUniformsSize);
    device.queue.writeBuffer(this.viewBuffer, 0, this.uniformsArray.buffer, ProjectionUniformsSize, ViewUniformsSize);
  }

  updateMatricesForXR(timestamp, xrView, subImage) {
    this.outputSize[0] = subImage.colorTexture.width;
    this.outputSize[1] = subImage.colorTexture.height;

    this.zRange[0] = this.renderer.xrSession.renderState.depthNear;
    this.zRange[1] = this.renderer.xrSession.renderState.depthFar;

    this.timeArray[0] = timestamp;

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