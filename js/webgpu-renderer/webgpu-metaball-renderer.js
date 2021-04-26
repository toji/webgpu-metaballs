// Copyright 2021 Brandon Jones
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import { BIND_GROUP, ATTRIB_MAP } from './shaders/common.js';
import { MetaballVertexSource, MetaballFragmentSource } from './shaders/metaball.js';

const METABALLS_VERTEX_BUFFER_SIZE = (Float32Array.BYTES_PER_ELEMENT * 3) * 8196;
const METABALLS_INDEX_BUFFER_SIZE = Uint16Array.BYTES_PER_ELEMENT * 16384;

class WebGPUMetaballRendererBase {
  constructor(renderer) {
    this.renderer = renderer;
    this.device = renderer.device;

    this.vertexBufferSize = METABALLS_VERTEX_BUFFER_SIZE;
    this.indexBufferSize = METABALLS_INDEX_BUFFER_SIZE;

    this.indexCount = 0;

    // Metaball resources
    this.vertexBuffer = this.device.createBuffer({
      size: this.vertexBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
    });

    this.normalBuffer = this.device.createBuffer({
      size: this.vertexBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX,
    });

    this.indexBuffer = this.device.createBuffer({
      size: this.indexBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.INDEX,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.renderer.bindGroupLayouts.frame,
          this.renderer.bindGroupLayouts.metaball
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
          format: this.renderer.swapChainFormat,
        }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: this.renderer.renderBundleDescriptor.depthStencilFormat,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample: {
        count: this.renderer.renderBundleDescriptor.sampleCount
      }
    });
  }

  update(marchingCubes) {
    throw new Error('update must be implemented in a class that extends WebGPUMetaballRendererBase');
  }

  draw(passEncoder) {
    if (this.indexCount) {
      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(BIND_GROUP.Frame, this.renderer.bindGroups.frame);
      passEncoder.setBindGroup(1, this.renderer.bindGroups.metaball);
      passEncoder.setVertexBuffer(0, this.vertexBuffer);
      passEncoder.setVertexBuffer(1, this.normalBuffer);
      passEncoder.setIndexBuffer(this.indexBuffer, 'uint16');
      passEncoder.drawIndexed(this.indexCount, 1, 0, 0, 0);
    }
  }
}

export class MetaballWriteBuffer extends WebGPUMetaballRendererBase {
  constructor(renderer, vertexBufferSize, indexBufferSize) {
    super(renderer, vertexBufferSize, indexBufferSize);

    this.vertexBufferElements = this.vertexBufferSize / Float32Array.BYTES_PER_ELEMENT;
    this.indexBufferElements = this.indexBufferSize / Uint16Array.BYTES_PER_ELEMENT

    this.vertexArray = new Float32Array(this.vertexBufferElements);
    this.normalArray = new Float32Array(this.vertexBufferElements);
    this.indexArray = new Uint16Array(this.indexBufferElements);
  }

  async update(marchingCubes) {
    this.indexCount = marchingCubes.generateMesh({
      positions: this.vertexArray,
      normals:   this.normalArray,
      indices:   this.indexArray
    });

    this.device.queue.writeBuffer(this.vertexBuffer, 0, this.vertexArray, 0, this.vertexBufferElements);
    this.device.queue.writeBuffer(this.normalBuffer, 0, this.normalArray, 0, this.vertexBufferElements);
    this.device.queue.writeBuffer(this.indexBuffer, 0, this.indexArray, 0, this.indexBufferElements);
  }
}

export class MetaballNewBuffer extends WebGPUMetaballRendererBase {
  constructor(renderer, vertexBufferSize, indexBufferSize) {
    super(renderer, vertexBufferSize, indexBufferSize);
  }

  async update(marchingCubes) {
    const newVertexBuffer = this.device.createBuffer({
      size: this.vertexBufferSize,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });

    const newNormalBuffer = this.device.createBuffer({
      size: this.vertexBufferSize,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });

    const newIndexBuffer = this.device.createBuffer({
      size: this.indexBufferSize,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
    });

    this.indexCount = marchingCubes.generateMesh({
      positions: new Float32Array(newVertexBuffer.getMappedRange()),
      normals:   new Float32Array(newNormalBuffer.getMappedRange()),
      indices:   new Uint16Array(newIndexBuffer.getMappedRange())
    });

    newVertexBuffer.unmap();
    newNormalBuffer.unmap();
    newIndexBuffer.unmap();

    this.vertexBuffer.destroy();
    this.normalBuffer.destroy();
    this.indexBuffer.destroy();

    this.vertexBuffer = newVertexBuffer;
    this.normalBuffer = newNormalBuffer;
    this.indexBuffer = newIndexBuffer;
  }
}

export class MetaballNewStagingBuffer extends WebGPUMetaballRendererBase {
  constructor(renderer, vertexBufferSize, indexBufferSize) {
    super(renderer, vertexBufferSize, indexBufferSize);
  }

  async update(marchingCubes) {
    const vertexStagingBuffer = this.device.createBuffer({
      size: this.vertexBufferSize,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });

    const normalStagingBuffer = this.device.createBuffer({
      size: this.vertexBufferSize,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });

    const indexStagingBuffer = this.device.createBuffer({
      size: this.indexBufferSize,
      usage: GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });

    this.indexCount = marchingCubes.generateMesh({
      positions: new Float32Array(vertexStagingBuffer.getMappedRange()),
      normals:   new Float32Array(normalStagingBuffer.getMappedRange()),
      indices:   new Uint16Array(indexStagingBuffer.getMappedRange())
    });

    vertexStagingBuffer.unmap();
    normalStagingBuffer.unmap();
    indexStagingBuffer.unmap();

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToBuffer(vertexStagingBuffer, 0, this.vertexBuffer, 0, this.vertexBufferSize);
    commandEncoder.copyBufferToBuffer(normalStagingBuffer, 0, this.normalBuffer, 0, this.vertexBufferSize);
    commandEncoder.copyBufferToBuffer(indexStagingBuffer, 0, this.indexBuffer, 0, this.indexBufferSize);
    this.device.queue.submit([commandEncoder.finish()]);

    vertexStagingBuffer.destroy();
    normalStagingBuffer.destroy();
    indexStagingBuffer.destroy();
  }
}

export class MetaballSingleStagingBuffer extends WebGPUMetaballRendererBase {
  constructor(renderer, vertexBufferSize, indexBufferSize) {
    super(renderer, vertexBufferSize, indexBufferSize);

    this.vertexStagingBuffer = this.device.createBuffer({
      size: this.vertexBufferSize,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
      mappedAtCreation: true,
    });

    this.normalStagingBuffer = this.device.createBuffer({
      size: this.vertexBufferSize,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
      mappedAtCreation: true,
    });

    this.indexStagingBuffer = this.device.createBuffer({
      size: this.indexBufferSize,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
      mappedAtCreation: true,
    });

    this.mappedPromise = Promise.resolve();
  }

  async update(marchingCubes) {
    await this.mappedPromise;

    this.indexCount = marchingCubes.generateMesh({
      positions: new Float32Array(this.vertexStagingBuffer.getMappedRange()),
      normals:   new Float32Array(this.normalStagingBuffer.getMappedRange()),
      indices:   new Uint16Array(this.indexStagingBuffer.getMappedRange())
    });

    this.vertexStagingBuffer.unmap();
    this.normalStagingBuffer.unmap();
    this.indexStagingBuffer.unmap();

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToBuffer(this.vertexStagingBuffer, 0, this.vertexBuffer, 0, this.vertexBufferSize);
    commandEncoder.copyBufferToBuffer(this.normalStagingBuffer, 0, this.normalBuffer, 0, this.vertexBufferSize);
    commandEncoder.copyBufferToBuffer(this.indexStagingBuffer, 0, this.indexBuffer, 0, this.indexBufferSize);
    this.device.queue.submit([commandEncoder.finish()]);

    this.mappedPromise = Promise.all([
      this.vertexStagingBuffer.mapAsync(GPUMapMode.WRITE),
      this.normalStagingBuffer.mapAsync(GPUMapMode.WRITE),
      this.indexStagingBuffer.mapAsync(GPUMapMode.WRITE)
    ]);
  }
}

export class MetaballStagingBufferRing extends WebGPUMetaballRendererBase {
  constructor(renderer, vertexBufferSize, indexBufferSize) {
    super(renderer, vertexBufferSize, indexBufferSize);

    this.readyBuffers = [];
  }

  getOrCreateStagingBuffers() {
    if (this.readyBuffers.length) {
      return this.readyBuffers.pop();
    }

    return {
      vertex: this.device.createBuffer({
        size: this.vertexBufferSize,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
        mappedAtCreation: true,
      }),
  
      normal: this.device.createBuffer({
        size: this.vertexBufferSize,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
        mappedAtCreation: true,
      }),
  
      index: this.device.createBuffer({
        size: this.indexBufferSize,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
        mappedAtCreation: true,
      }),
    };
  }

  async update(marchingCubes) {
    const stagingBuffers = this.getOrCreateStagingBuffers();

    this.indexCount = marchingCubes.generateMesh({
      positions: new Float32Array(stagingBuffers.vertex.getMappedRange()),
      normals:   new Float32Array(stagingBuffers.normal.getMappedRange()),
      indices:   new Uint16Array(stagingBuffers.index.getMappedRange())
    });

    stagingBuffers.vertex.unmap();
    stagingBuffers.normal.unmap();
    stagingBuffers.index.unmap();

    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToBuffer(stagingBuffers.vertex, 0, this.vertexBuffer, 0, this.vertexBufferSize);
    commandEncoder.copyBufferToBuffer(stagingBuffers.normal, 0, this.normalBuffer, 0, this.vertexBufferSize);
    commandEncoder.copyBufferToBuffer(stagingBuffers.index, 0, this.indexBuffer, 0, this.indexBufferSize);
    this.device.queue.submit([commandEncoder.finish()]);

    Promise.all([
      stagingBuffers.vertex.mapAsync(GPUMapMode.WRITE),
      stagingBuffers.normal.mapAsync(GPUMapMode.WRITE),
      stagingBuffers.index.mapAsync(GPUMapMode.WRITE)
    ]).then(() => {
      this.readyBuffers.push(stagingBuffers);
    });
  }
}