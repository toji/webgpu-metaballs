// Copyright 2020 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// This import installs hooks that help us output better formatted shader errors
import './wgsl-debug-helper.js';

import { Renderer } from '../renderer.js';
import { ProjectionUniformsSize, ViewUniformsSize, BIND_GROUP, ATTRIB_MAP } from './shaders/common.js';
import { PBRRenderBundleHelper } from './pbr-render-bundle-helper.js';
import { vec2, vec3, vec4 } from 'gl-matrix';
import { WebGPUTextureLoader } from 'webgpu-texture-loader';
import { ClusteredLightManager } from './clustered-lights.js';
import { WebGPULightSprites } from './webgpu-light-sprites.js';
import { MetaballVertexSource, MetaballFragmentSource } from './shaders/metaball.js';

// Can reuse these for every PBR material
const materialUniforms = new Float32Array(4 + 4 + 4);
const baseColorFactor = new Float32Array(materialUniforms.buffer, 0, 4);
const metallicRoughnessFactor = new Float32Array(materialUniforms.buffer, 4 * 4, 2);
const emissiveFactor = new Float32Array(materialUniforms.buffer, 8 * 4, 3);

const SAMPLE_COUNT = 4;
const DEPTH_FORMAT = "depth24plus";

const METABALLS_VERTEX_BUFFER_SIZE = (Float32Array.BYTES_PER_ELEMENT * 3) * 8196;
const METABALLS_INDEX_BUFFER_SIZE = Uint16Array.BYTES_PER_ELEMENT * 16384;

export class WebGPURenderer extends Renderer {
  constructor() {
    super();

    this.sampleCount = SAMPLE_COUNT;
    this.depthFormat = DEPTH_FORMAT;

    this.context = this.canvas.getContext('gpupresent');

    this.outputHelpers = {
      'clustered-forward': PBRRenderBundleHelper,
    };
  }

  async init() {
    this.outputRenderBundles = {};

    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance"
    });

    // Enable compressed textures if available
    const nonGuaranteedFeatures = [];
    if (this.adapter.features.has('texture-compression-bc') != -1) {
      nonGuaranteedFeatures.push('texture-compression-bc');
    }

    this.device = await this.adapter.requestDevice({nonGuaranteedFeatures});

    this.swapChainFormat = this.context.getSwapChainPreferredFormat(this.adapter);
    this.swapChain = this.context.configureSwapChain({
      device: this.device,
      format: this.swapChainFormat
    });

    this.renderBundleDescriptor = {
      colorFormats: [ this.swapChainFormat ],
      depthStencilFormat: DEPTH_FORMAT,
      sampleCount: SAMPLE_COUNT
    };

    this.textureLoader = new WebGPUTextureLoader(this.device);

    this.colorAttachment = {
      // attachment is acquired and set in onResize.
      attachment: undefined,
      // attachment is acquired and set in onFrame.
      resolveTarget: undefined,
      loadValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
    };

    this.depthAttachment = {
      // attachment is acquired and set in onResize.
      attachment: undefined,
      depthLoadValue: 1.0,
      depthStoreOp: 'store',
      stencilLoadValue: 0,
      stencilStoreOp: 'store',
    };

    this.renderPassDescriptor = {
      colorAttachments: [this.colorAttachment],
      depthStencilAttachment: this.depthAttachment
    };

    this.bindGroupLayouts = {
      frame: this.device.createBindGroupLayout({
        label: `frame-bgl`,
        entries: [{
          binding: 0, // Projection uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: {},
        }, {
          binding: 1, // View uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
          buffer: {}
        }, {
          binding: 2, // Light uniforms
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' }
        }, {
          binding: 3, // Cluster Lights storage
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' }
        }]
      }),

      material: this.device.createBindGroupLayout({
        label: `material-bgl`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: {}
        },
        {
          binding: 1, // defaultSampler
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 2, // baseColorTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 3, // normalTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 4, // metallicRoughnessTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 5, // occlusionTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        },
        {
          binding: 6, // emissiveTexture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        }]
      }),

      primitive: this.device.createBindGroupLayout({
        label: `primitive-bgl`,
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: {}
        }]
      }),

      metaball: this.device.createBindGroupLayout({
        label: `lava-bgl`,
        entries: [{
          binding: 0, // sampler
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {}
        },
        {
          binding: 1, // texture
          visibility: GPUShaderStage.FRAGMENT,
          texture: {}
        }]
      })
    };

    this.pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        this.bindGroupLayouts.frame, // set 0
        this.bindGroupLayouts.material, // set 1
        this.bindGroupLayouts.primitive, // set 2
      ]
    });

    this.projectionBuffer = this.device.createBuffer({
      size: ProjectionUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.viewBuffer = this.device.createBuffer({
      size: ViewUniformsSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });

    this.lightsBuffer = this.device.createBuffer({
      size: this.lightManager.uniformArray.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });

    this.clusteredLights = new ClusteredLightManager(this);

    this.bindGroups = {
      frame: this.device.createBindGroup({
        layout: this.bindGroupLayouts.frame,
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
            buffer: this.lightsBuffer,
          },
        }, {
          binding: 3,
          resource: {
            buffer: this.clusteredLights.clusterLightsBuffer,
          }
        }],
      })
    }

    this.blackTextureView = this.textureLoader.fromColor(0, 0, 0, 0).texture.createView();
    this.whiteTextureView = this.textureLoader.fromColor(1.0, 1.0, 1.0, 1.0).texture.createView();
    this.blueTextureView = this.textureLoader.fromColor(0, 0, 1.0, 0).texture.createView();

    this.defaultSampler = this.device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });

    this.lightSprites = new WebGPULightSprites(this);
  }

  onResize(width, height) {
    if (!this.device) return;

    const msaaColorTexture = this.device.createTexture({
      size: { width, height },
      sampleCount: SAMPLE_COUNT,
      format: this.swapChainFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.colorAttachment.view = msaaColorTexture.createView();

    const depthTexture = this.device.createTexture({
      size: { width, height },
      sampleCount: SAMPLE_COUNT,
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.depthAttachment.view = depthTexture.createView();

    // Update the Projection uniforms. These only need to be updated on resize.
    this.device.queue.writeBuffer(this.projectionBuffer, 0, this.frameUniforms.buffer, 0, ProjectionUniformsSize);

    // On every size change we need to re-compute the cluster grid.
    this.clusteredLights.updateClusterBounds();
  }

  async setGltf(gltf) {
    super.setGltf(gltf);

    const resourcePromises = [];

    for (let bufferView of gltf.bufferViews) {
      resourcePromises.push(this.initBufferView(bufferView));
    }

    for (let image of gltf.images) {
      resourcePromises.push(this.initImage(image));
    }

    for (let sampler of gltf.samplers) {
      this.initSampler(sampler);
    }

    this.initNode(gltf.scene);

    await Promise.all(resourcePromises);

    for (let material of gltf.materials) {
      this.initMaterial(material);
    }

    for (let primitive of gltf.primitives) {
      this.initPrimitive(primitive);
    }

    this.outputRenderBundles = {};
    this.primitives = gltf.primitives;

    this.updateMetaballs(0);
  }

  async initBufferView(bufferView) {
    let usage = 0;
    if (bufferView.usage.has('vertex')) {
      usage |= GPUBufferUsage.VERTEX;
    }
    if (bufferView.usage.has('index')) {
      usage |= GPUBufferUsage.INDEX;
    }

    if (!usage) {
      return;
    }

    // Oh FFS. Buffer copies have to be 4 byte aligned, I guess. >_<
    const alignedLength = Math.ceil(bufferView.byteLength / 4) * 4;

    const gpuBuffer = this.device.createBuffer({
      size: alignedLength,
      usage: usage | GPUBufferUsage.COPY_DST
    });
    bufferView.renderData.gpuBuffer = gpuBuffer;

    // TODO: Pretty sure this can all be handled more efficiently.
    const copyBuffer = this.device.createBuffer({
      size: alignedLength,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true
    });
    const copyBufferArray = new Uint8Array(copyBuffer.getMappedRange());

    const bufferData = await bufferView.dataView;

    const srcByteArray = new Uint8Array(bufferData.buffer, bufferData.byteOffset, bufferData.byteLength);
    copyBufferArray.set(srcByteArray);
    copyBuffer.unmap();

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToBuffer(copyBuffer, 0, gpuBuffer, 0, alignedLength);
    this.device.queue.submit([commandEncoder.finish()]);
  }

  async initImage(image) {
    const result = await this.textureLoader.fromBlob(await image.blob, {colorSpace: image.colorSpace});
    image.gpuTextureView = result.texture.createView();
  }

  initSampler(sampler) {
    sampler.renderData.gpuSampler = this.device.createSampler(sampler.gpuSamplerDescriptor);
  }

  initMaterial(material) {
    vec4.copy(baseColorFactor, material.baseColorFactor);
    vec2.copy(metallicRoughnessFactor, material.metallicRoughnessFactor);
    vec3.copy(emissiveFactor, material.emissiveFactor);

    const materialBuffer = this.device.createBuffer({
      size: materialUniforms.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(materialBuffer, 0, materialUniforms);

    const materialBindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayouts.material,
      entries: [{
        binding: 0,
        resource: {
          buffer: materialBuffer,
        },
      },
      {
        binding: 1,
        // TODO: Do we really need to pass one sampler per texture for accuracy? :(
        resource: material.baseColorTexture.sampler.renderData.gpuSampler,
      },
      {
        binding: 2,
        resource: material.baseColorTexture ? material.baseColorTexture.image.gpuTextureView : this.whiteTextureView,
      },
      {
        binding: 3,
        resource: material.normalTexture ? material.normalTexture.image.gpuTextureView : this.blueTextureView,
      },
      {
        binding: 4,
        resource: material.metallicRoughnessTexture ? material.metallicRoughnessTexture.image.gpuTextureView : this.whiteTextureView,
      },
      {
        binding: 5,
        resource: material.occlusionTexture ? material.occlusionTexture.image.gpuTextureView : this.whiteTextureView,
      },
      {
        binding: 6,
        resource: material.emissiveTexture ? material.emissiveTexture.image.gpuTextureView : this.blackTextureView,
      }],
    });

    material.renderData.gpuBindGroup = materialBindGroup;
  }

  initPrimitive(primitive) {
    const bufferSize = 16 * 4;

    // TODO: Support multiple instances
    if (primitive.renderData.instances.length) {
      const modelBuffer = this.device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.device.queue.writeBuffer(modelBuffer, 0, primitive.renderData.instances[0]);

      const modelBindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayouts.primitive,
        entries: [{
          binding: 0,
          resource: {
            buffer: modelBuffer,
          },
        }],
      });

      primitive.renderData.gpuBindGroup = modelBindGroup;
    }
  }

  initNode(node) {
    for (let primitive of node.primitives) {
      if (!primitive.renderData.instances) {
        primitive.renderData.instances = [];
      }
      primitive.renderData.instances.push(node.worldMatrix);
    }

    for (let childNode of node.children) {
      this.initNode(childNode);
    }
  }

  async setMetaballStyle(style) {
    super.setMetaballStyle(style);

    const metaballTexture = await this.textureLoader.fromUrl(this.metaballTexturePath, {colorSpace: 'sRGB'});

    this.bindGroups.metaball = this.device.createBindGroup({
      layout: this.bindGroupLayouts.metaball,
      entries: [{
        binding: 0,
        resource: this.defaultSampler,
      }, {
        binding: 1,
        resource: metaballTexture.texture.createView(),
      }],
    });
  }

  updateMetaballs(timestamp) {
    super.updateMetaballs(timestamp);

    if (!this.primitives) {
      return;
    }

    if (!this.metaballsPipeline) {
      this.metaballsVertexBuffer = this.device.createBuffer({
        size: METABALLS_VERTEX_BUFFER_SIZE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
      });

      this.metaballsNormalBuffer = this.device.createBuffer({
        size: METABALLS_VERTEX_BUFFER_SIZE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
      });

      this.metaballsIndexBuffer = this.device.createBuffer({
        size: METABALLS_INDEX_BUFFER_SIZE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.INDEX,
      });

      this.metaballsPipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [
            this.bindGroupLayouts.frame,
            this.bindGroupLayouts.metaball
          ]
        }),
        vertex: {
          module: this.device.createShaderModule({ code: MetaballVertexSource }),
          entryPoint: "vertexMain",
          buffers: [{
            arrayStride: 12,
            attributes: [{
              shaderLocation: ATTRIB_MAP.POSITION,
              format: 'float32x3',
              offset: 0
            }],
          }, {
            arrayStride: 12,
            attributes: [{
              shaderLocation: ATTRIB_MAP.NORMAL,
              format: 'float32x3',
              offset: 0
            }],
          }]
        },
        fragment: {
          module: this.device.createShaderModule({ code: MetaballFragmentSource }),
          entryPoint: "fragmentMain",
          targets: [{
            format: this.swapChainFormat,
          }]
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'none',
        },
        depthStencil: {
          format: DEPTH_FORMAT,
          depthWriteEnabled: true,
          depthCompare: 'less',
        },
        multisample: {
          count: SAMPLE_COUNT
        }
      });
    }

    this.metaballsVertexCopyBuffer = this.device.createBuffer({
      size: METABALLS_VERTEX_BUFFER_SIZE,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });

    this.metaballsNormalCopyBuffer = this.device.createBuffer({
      size: METABALLS_VERTEX_BUFFER_SIZE,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });

    this.metaballsIndexCopyBuffer = this.device.createBuffer({
      size: METABALLS_INDEX_BUFFER_SIZE,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });

    const arrays = {
      positions: new Float32Array(this.metaballsVertexCopyBuffer.getMappedRange()),
      normals: new Float32Array(this.metaballsNormalCopyBuffer.getMappedRange()),
      indices: new Uint16Array(this.metaballsIndexCopyBuffer.getMappedRange()),
      vertexOffset: 0,
      indexOffset: 0,
    };

    this.metaballsIndexCount = this.metaballs.generateMesh(arrays);

    this.metaballsVertexCopyBuffer.unmap();
    this.metaballsNormalCopyBuffer.unmap();
    this.metaballsIndexCopyBuffer.unmap();

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToBuffer(this.metaballsVertexCopyBuffer, 0, this.metaballsVertexBuffer, 0, METABALLS_VERTEX_BUFFER_SIZE);
    commandEncoder.copyBufferToBuffer(this.metaballsNormalCopyBuffer, 0, this.metaballsNormalBuffer, 0, METABALLS_VERTEX_BUFFER_SIZE);
    commandEncoder.copyBufferToBuffer(this.metaballsIndexCopyBuffer, 0, this.metaballsIndexBuffer, 0, METABALLS_INDEX_BUFFER_SIZE);
    this.device.queue.submit([commandEncoder.finish()]);

    this.metaballsVertexCopyBuffer.destroy();
    this.metaballsIndexCopyBuffer.destroy();
  }

  onFrame(timestamp) {
    // TODO: If we want multisampling this should attach to the resolveTarget,
    // but there seems to be a bug with that right now?
    this.colorAttachment.resolveTarget = this.swapChain.getCurrentTexture().createView();

    // Update the View uniforms buffer with the values. These are used by most shader programs
    // and don't change for the duration of the frame.
    this.device.queue.writeBuffer(this.viewBuffer, 0, this.frameUniforms.buffer, ProjectionUniformsSize, ViewUniformsSize);

    // Update the light unform buffer with the latest values as well.
    this.device.queue.writeBuffer(this.lightsBuffer, 0, this.lightManager.uniformArray);

    // Create a render bundle for the requested output type if one doesn't already exist.
    let renderBundle = this.outputRenderBundles[this.outputType];
    if (!renderBundle && this.primitives) {
      const helperConstructor = this.outputHelpers[this.outputType];
      const renderBundleHelper = new helperConstructor(this);
      renderBundle = this.outputRenderBundles[this.outputType] = renderBundleHelper.createRenderBundle(this.primitives);
    }

    const commandEncoder = this.device.createCommandEncoder({});
    this.clusteredLights.updateClusterLights(commandEncoder);

    const passEncoder = commandEncoder.beginRenderPass(this.renderPassDescriptor);

    if (renderBundle) {
      passEncoder.executeBundles([renderBundle]);
    }

    if (this.metaballsPipeline && this.bindGroups.metaball) {
      passEncoder.setPipeline(this.metaballsPipeline);
      passEncoder.setBindGroup(BIND_GROUP.Frame, this.bindGroups.frame);
      passEncoder.setBindGroup(1, this.bindGroups.metaball);
      passEncoder.setVertexBuffer(0, this.metaballsVertexBuffer);
      passEncoder.setVertexBuffer(1, this.metaballsNormalBuffer);
      passEncoder.setIndexBuffer(this.metaballsIndexBuffer, 'uint16');
      passEncoder.drawIndexed(this.metaballsIndexCount, 1, 0, 0, 0);
    }

    if (this.lightManager.render) {
      // Last, render a sprite for all of the lights. This is done using instancing so it's a single
      // call for every light.
      this.lightSprites.draw(passEncoder);
    }

    passEncoder.endPass();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}