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
import {
  MetaballFieldComputeSource,
  MarchingCubesComputeSource,
  WORKGROUP_SIZE,
  MetaballRenderSource,
  MetaballRenderPointSource
} from './shaders/metaball.js';
import {
  MarchingCubesEdgeTable,
  MarchingCubesTriTable,
} from "../marching-cubes-tables.js";

const MAX_METABALLS = 32;

// Common assets used by every variant of the Metaball renderer
class WebGPUMetaballRendererBase {
  constructor(renderer, volume, createBuffers=true) {
    this.renderer = renderer;
    this.device = renderer.device;
    this.volume = volume;

    // Computes buffer sizes large enough for the maximum possible number of triangles in that volume
    this.marchingCubeCells = (volume.width-1) * (volume.height-1) * (volume.depth-1);
    this.vertexBufferSize = (Float32Array.BYTES_PER_ELEMENT * 3) * 12 * this.marchingCubeCells;
    this.indexBufferSize = Uint32Array.BYTES_PER_ELEMENT * 15 * this.marchingCubeCells;

    this.indexCount = 0;

    // Metaball resources
    if (createBuffers) {
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
    }

    const module = this.device.createShaderModule({ code: MetaballRenderSource })

    // TODO: It seems like there's a failure on Pixel 4 when this is async?
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.renderer.bindGroupLayouts.frame,
          this.renderer.bindGroupLayouts.metaball
        ]
      }),
      vertex: {
        module,
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
        module,
        targets: [{
          format: this.renderer.renderFormat,
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

  updateMetaballs(metaballs, marchingCubes) {
    marchingCubes.updateVolume(metaballs);
  }

  update(marchingCubes) {
    throw new Error('update must be implemented in a class that extends WebGPUMetaballRendererBase');
  }

  updateCompute(commandEncoder, timestampHelper) {
    // Only for the GPU-based renderers
  }

  draw(passEncoder, view) {
    if (this.indexCount && this.pipeline) {
      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(BIND_GROUP.Frame, view.bindGroup);
      passEncoder.setBindGroup(1, this.renderer.bindGroups.metaball);
      passEncoder.setVertexBuffer(0, this.vertexBuffer);
      passEncoder.setVertexBuffer(1, this.normalBuffer);
      passEncoder.setIndexBuffer(this.indexBuffer, 'uint32');
      passEncoder.drawIndexed(this.indexCount, 1, 0, 0, 0);
    }
  }
}

//
// writeBuffer()
//

/**
 * This path uses queue.writeBuffer() to update the vertex and index buffers every frame.
 * writeBuffer() is a convenice function that copies from an ArrayBuffer into a GPUBuffer in
 * whatever way the user agent deems best. In many scenarios this can be one of the most efficent
 * routes.
 *
 * Advantages:
 *  - Lowest overall complexity.
 *  - If your data is already in an ArrayBuffer, this will handle the copy for you.
 *  - Potentially best for WASM apps, which need to perform an additional copy from the WASM heap
 *    when using mapped buffers anyway.
 *  - Avoids the need to set the contents of a mapped buffer's array to zero before returning it.
 *  - Allows the user agent to pick an optimal pattern for uploading the data to the GPU.
 *
 * Disadvantages:
 *  - Requires a CPU-side copy
 *  - Requires a GPU-side copy
 *  - TODO
 */
export class MetaballWriteBuffer extends WebGPUMetaballRendererBase {
  constructor(renderer, volume) {
    super(renderer, volume);

    this.vertexBufferElements = this.vertexBufferSize / Float32Array.BYTES_PER_ELEMENT;
    this.indexBufferElements = this.indexBufferSize / Uint32Array.BYTES_PER_ELEMENT

    this.vertexArray = new Float32Array(this.vertexBufferElements);
    this.normalArray = new Float32Array(this.vertexBufferElements);
    this.indexArray = new Uint32Array(this.indexBufferElements);
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

//
// Created a new buffer that is mappedAtCreation each time.
//

/**
 * This path creates a new set of buffers each time the data needs to be updated with
 * mappedAtCreation set to true. This allows the buffer's data to immediately be populated, even
 * for buffers that don't have MAP or COPY usage specified. However, this method only allows the
 * buffer's data to be set once, and if the data is changed either a new buffer will need to be
 * created or one of the other techniques, in conjunction with the appropriate usage flags, will
 * need to be used to update the buffer. As such this technique is good for buffers that will never
 * change or changes very infrequently.
 *
 * Advantages:
 *  - Can set the buffer data immediately.
 *  - No specific usage flags required.
 *  - Data can be written directly into the mapped buffer, avoiding a CPU-side copy in some cases.
 *
 * Disadvantages:
 *  - Only works for newly created buffers.
 *  - If buffer data changes frequently results in lots of buffer creation and destruction.
 *  - User agent must zero out the buffer when it's mapped.
 *  - If data is already in an ArrayBuffer, requires another CPU-side copy.
 *  - Requires a GPU-side copy
 */
export class MetaballNewBuffer extends WebGPUMetaballRendererBase {
  constructor(renderer, volume) {
    super(renderer, volume, false);
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
      indices:   new Uint32Array(newIndexBuffer.getMappedRange())
    });

    newVertexBuffer.unmap();
    newNormalBuffer.unmap();
    newIndexBuffer.unmap();

    if (this.vertexBuffer) {
      this.vertexBuffer.destroy();
      this.normalBuffer.destroy();
      this.indexBuffer.destroy();
    }

    this.vertexBuffer = newVertexBuffer;
    this.normalBuffer = newNormalBuffer;
    this.indexBuffer = newIndexBuffer;
  }
}

//
// Created a new staging buffer that is mappedAtCreation each time.
//

/**
 * This path is similar to the previous one, but uses a single set of vertex/index buffers and
 * creates a new set of staging buffers with mappedAtCreation set to true to copy from each time the
 * data needs to be updated. This allows the staging buffer's data to immediately be populated,
 * though the data still needs to be copied from the staging buffer into the vertex/index buffers
 * once the staging buffer is unmapped. This method only uses each staging buffer once, and if the
 * data is changed a new staging buffer is created. As such this technique is best for buffers that
 * changes infrequently.
 *
 * Advantages:
 *  - Can set the buffer data immediately.
 *  - Data can be written directly into the mapped buffer, avoiding a CPU-side copy in some cases.
 *
 * Disadvantages:
 *  - If buffer data changes frequently results in lots of staging buffer creation and destruction.
 *  - User agent must zero out the staging buffer when it's mapped.
 *  - If data is already in an ArrayBuffer, requires another CPU-side copy.
 *  - Requires a GPU-side copy
 */
export class MetaballNewStagingBuffer extends WebGPUMetaballRendererBase {
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
      indices:   new Uint32Array(indexStagingBuffer.getMappedRange())
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

//
// Reusing a single staging buffer.
//

/**
 * This path uses a single set of staging buffers and a single set of vertex/index buffers. Each
 * time the data is updated the staging buffer is immedately re-mapped, and when it's time to update
 * the buffer again the application waits for the mapping to complete before writing the data.
 * This tightly controls the total amount of memory used to update the buffer, but can result in
 * stalls if the data needs to be updated before the staging buffer has finished mapping again.
 * As such this technique is best for buffers that change with moderate frequency, such as every
 * few frames.
 *
 * Advantages:
 *  - Well bounded memory usage.
 *  - No ongoing creation/destruction overhead.
 *  - Staging buffer re-use means initialization costs are only paid once.
 *  - Data can be written directly into the mapped buffer, avoiding a CPU-side copy in some cases.
 *
 * Disadvantages:
 *  - Need to wait for staging buffer to be mapped each time buffer is updated.
 *  - User agent must zero out the staging buffer the first time it's mapped.
 *  - If data is already in an ArrayBuffer, requires another CPU-side copy.
 *  - Requires a GPU-side copy
 */
export class MetaballSingleStagingBuffer extends WebGPUMetaballRendererBase {
  constructor(renderer, volume) {
    super(renderer, volume);

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
      indices:   new Uint32Array(this.indexStagingBuffer.getMappedRange())
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

//
// Staging buffer ring.
//

/**
 * This path uses a rotating set of staging buffers and a single set of vertex/index buffers. Each
 * time the data is updated it first checks to see if a previously used staging buffer is already
 * mapped and ready to use, and if so writes the data into that. If not, a new staging buffer is
 * created with mappedAtCreation set to true so that it can immedately be populated. After the data
 * is copied GPU-side the staging buffer is immedately mapped again, and once the mapping is
 * complete it's placed in the queue of buffers which are ready for use. If the buffer data is
 * updated frequently this typically results in a list of 2-3 staging buffers that are cycled
 * through. This technique is best for buffers that change very frequency, such as every frame.
 *
 * Advantages:
 *  - Limits buffer creation.
 *  - Doesn't wait on previously used buffers to be mapped.
 *  - Staging buffer re-use means initialization costs are only paid once per set.
 *  - Data can be written directly into the mapped buffer, avoiding a CPU-side copy in some cases.
 *
 * Disadvantages:
 *  - Higher complexity than other methods.
 *  - Higher ongoing memory usage.
 *  - User agent must zero out the staging buffers the first time they are mapped.
 *  - If data is already in an ArrayBuffer, requires another CPU-side copy.
 *  - Requires a GPU-side copy
 */
export class MetaballStagingBufferRing extends WebGPUMetaballRendererBase {
  constructor(renderer, volume) {
    super(renderer, volume);

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
      indices:   new Uint32Array(stagingBuffers.index.getMappedRange())
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

/**
 * For certain types of algorithmically generated data, it may be possible to generate the data in
 * a compute shader. This allows the data to be directly populated into the GPU-side buffer with
 * no copies, and as a result can be the most efficent route. Not every data set is well suited for
 * generation within a compute shader, however, and as such this method is only practical for data
 * which is algorithmically generated (for example: particle effects).
 *
 * Advantages:
 *  - Does not require staging buffers.
 *  - No CPU or GPU-side copies.
 *  - Takes advantage of GPU hardware, parallelism.
 *
 * Disadvantages:
 *  - Potentially high complexity.
 *  - Not all algorithms are well suited for implementation as a compute shader.
 *  - May still require copy of external data for use in the shader.
 */

export class MetaballComputeRenderer extends WebGPUMetaballRendererBase {
  constructor(renderer, volume) {
    super(renderer, volume, false);

    // Fill a buffer with the lookup tables we need for the marching cubes algorithm.
    this.tablesBuffer = this.device.createBuffer({
      size: (MarchingCubesEdgeTable.length + MarchingCubesTriTable.length) * 4,
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true,
    });

    const tablesArray = new Int32Array(this.tablesBuffer.getMappedRange());
    tablesArray.set(MarchingCubesEdgeTable);
    tablesArray.set(MarchingCubesTriTable, MarchingCubesEdgeTable.length);
    this.tablesBuffer.unmap();

    this.volumeElements = volume.width * volume.height * volume.depth;
    this.volumeBufferSize = (Float32Array.BYTES_PER_ELEMENT * 12) +
                            (Uint32Array.BYTES_PER_ELEMENT * 4) +
                            (Float32Array.BYTES_PER_ELEMENT * this.volumeElements);

    this.volumeBuffer = this.device.createBuffer({
      size: this.volumeBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });

    // Fill the buffer with information about the isosurface volume.
    const volumeMappedArray = this.volumeBuffer.getMappedRange();
    const volumeFloat32 = new Float32Array(volumeMappedArray);
    const volumeSize = new Uint32Array(volumeMappedArray, 48, 3);

    volumeFloat32[0] = volume.xMin;
    volumeFloat32[1] = volume.yMin;
    volumeFloat32[2] = volume.zMin;

    volumeFloat32[4] = volume.xMax;
    volumeFloat32[5] = volume.yMax;
    volumeFloat32[6] = volume.zMax;

    volumeFloat32[8] = volume.xStep;
    volumeFloat32[9] = volume.yStep;
    volumeFloat32[10] = volume.zStep;

    volumeSize[0] = volume.width;
    volumeSize[1] = volume.height;
    volumeSize[2] = volume.depth;

    volumeFloat32[15] = 40; // Threshold. TODO: Should be dynamic.

    this.volumeBuffer.unmap();

    this.metaballBufferSize = (Uint32Array.BYTES_PER_ELEMENT * 4) + (Float32Array.BYTES_PER_ELEMENT * 8 * MAX_METABALLS);
    this.metaballArray = new ArrayBuffer(this.metaballBufferSize);
    this.metaballArrayHeader = new Uint32Array(this.metaballArray, 0, 4);
    this.metaballArrayBalls = new Float32Array(this.metaballArray, 16);

    this.marchingCubeCells = (volume.width) * (volume.height) * (volume.depth);
    this.vertexBufferSize = (Float32Array.BYTES_PER_ELEMENT * 3) * 12 * this.marchingCubeCells;
    this.indexBufferSize = Uint32Array.BYTES_PER_ELEMENT * 15 * this.marchingCubeCells;

    this.indirectArray = new Uint32Array(9);
    this.indirectArray[0] = 4; // Number of vertices for point rendering
    this.indirectArray[5] = 1; // Number of instances for normal rendering

    const createMetaballResources = () => {
      // Metaball GPU resources
      const resources = {
        metaballBuffer: this.device.createBuffer({
          size: this.metaballBufferSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),

        vertexBuffer: this.device.createBuffer({
          size: this.vertexBufferSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
        }),

        normalBuffer: this.device.createBuffer({
          size: this.vertexBufferSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
        }),

        indexBuffer: this.device.createBuffer({
          size: this.indexBufferSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX,
        }),

        indirectBuffer: this.device.createBuffer({
          size: this.indirectArray.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        }),
      };

      return resources;
    }

    // Two sets of resources so we can ping-pong between them
    this.resources = [createMetaballResources(), createMetaballResources()];

    // Create compute pipeline that handles the metaball isosurface.
    const metaballModule = this.device.createShaderModule({
      label: 'Metaball Isosurface Compute Shader',
      code: MetaballFieldComputeSource
    });

    this.device.createComputePipelineAsync({
      label: 'Metaball Isosurface Compute Pipeline',
      layout: 'auto',
      compute: { module: metaballModule, entryPoint: 'computeMain' }
    }).then((pipeline) => {
      this.metaballComputePipeline = pipeline;

      for (const resource of this.resources) {
        resource.metaballComputeBindGroup = this.device.createBindGroup({
          layout: this.metaballComputePipeline.getBindGroupLayout(0),
          entries: [{
            binding: 0,
            resource: {
              buffer: resource.metaballBuffer,
            },
          }, {
            binding: 1,
            resource: {
              buffer: this.volumeBuffer,
            },
          }],
        });
      }
    });

    // Create compute pipeline that handles the marching cubes triangulation.
    const marchingCubesModule = this.device.createShaderModule({
      label: 'Marching Cubes Compute Shader',
      code: MarchingCubesComputeSource
    });

    this.device.createComputePipelineAsync({
      label: 'Marching Cubes Compute Pipeline',
      layout: 'auto',
      compute: { module: marchingCubesModule, entryPoint: 'computeMain' }
    }).then((pipeline) => {;
      this.marchingCubesComputePipeline = pipeline;

      for (const resource of this.resources) {
        resource.marchingCubesComputeBindGroup = this.device.createBindGroup({
          layout: this.marchingCubesComputePipeline.getBindGroupLayout(0),
          entries: [{
            binding: 0,
            resource: {
              buffer: this.tablesBuffer,
            },
          }, {
            binding: 1,
            resource: {
              buffer: this.volumeBuffer,
            },
          }, {
            binding: 2,
            resource: {
              buffer: resource.vertexBuffer,
            },
          }, {
            binding: 3,
            resource: {
              buffer: resource.normalBuffer,
            },
          }, {
            binding: 4,
            resource: {
              buffer: resource.indexBuffer,
            },
          }, {
            binding: 5,
            resource: {
              buffer: resource.indirectBuffer,
            },
          }],
        });
      }
    });

    this.drawIndex = 0;
    this.computeIndex = 0;
  }

  updateMetaballs(metaballs, marchingCubes) {
    this.metaballArrayHeader[0] = metaballs.balls.length;

    for (let i = 0; i < metaballs.balls.length; ++i) {
      const ball = metaballs.balls[i];
      const offset = i * 8;
      this.metaballArrayBalls[offset] = ball.position[0];
      this.metaballArrayBalls[offset+1] = ball.position[1];
      this.metaballArrayBalls[offset+2] = ball.position[2];
      this.metaballArrayBalls[offset+3] = ball.radius;
      this.metaballArrayBalls[offset+4] = ball.strength;
      this.metaballArrayBalls[offset+5] = ball.subtract;
    }

    // Update the metaball buffer with the latest metaball values.
    this.device.queue.writeBuffer(this.resources[this.computeIndex].metaballBuffer, 0, this.metaballArray);
  }

  update(marchingCubes) {}

  updateCompute(commandEncoder, timestampHelper) {
    this.drawIndex = this.computeIndex;
    this.computeIndex = (this.computeIndex + 1) % this.resources.length;

    const resource = this.resources[this.computeIndex];

    const dispatchSize = [
      Math.ceil((this.volume.width) / WORKGROUP_SIZE[0]),
      Math.ceil((this.volume.height) / WORKGROUP_SIZE[1]),
      Math.ceil((this.volume.depth) / WORKGROUP_SIZE[2])
    ];

    this.device.queue.writeBuffer(resource.indirectBuffer, 0, this.indirectArray);

    if (this.renderer.needsComputeWorkaround) {
      // For the Pixel 4, something about the indirect draw is causing a crash
      // so instead we'll use a regular indexed draw. This requires the indices
      // to be cleared prior to rendering, though, to fill the excess buffer
      // with degenerate triangles.
      commandEncoder.clearBuffer(resource.indexBuffer);
      this.indexCount = this.indexBufferSize / Uint32Array.BYTES_PER_ELEMENT;
    }

    if (this.metaballComputePipeline && this.marchingCubesComputePipeline) {
      // Run the compute shaders to fill the position/normal/index buffers.
      const passEncoder = commandEncoder.beginComputePass({
        timestampWrites: timestampHelper.timestampWrites('Metaballs')
      });

      passEncoder.setPipeline(this.metaballComputePipeline);
      passEncoder.setBindGroup(0, resource.metaballComputeBindGroup);
      passEncoder.dispatchWorkgroups(...dispatchSize);

      passEncoder.setPipeline(this.marchingCubesComputePipeline);
      passEncoder.setBindGroup(0, resource.marchingCubesComputeBindGroup);
      passEncoder.dispatchWorkgroups(...dispatchSize);

      passEncoder.end();
    }
  }

  draw(passEncoder, view) {
    // Pipeline may not be ready because it's created asynchronously.
    if (!this.pipeline) { return; }

    if (this.renderer.needsComputeWorkaround) {
      // Do a regular indexed draw.
      super.draw(passEncoder);
      return;
    }

    const resource = this.resources[this.drawIndex];

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, view.bindGroup);
    passEncoder.setBindGroup(1, this.renderer.bindGroups.metaball);
    passEncoder.setVertexBuffer(0, resource.vertexBuffer);
    passEncoder.setVertexBuffer(1, resource.normalBuffer);
    passEncoder.setIndexBuffer(resource.indexBuffer, 'uint32');
    passEncoder.drawIndexedIndirect(resource.indirectBuffer, 16);
  }
}

export class MetaballComputePointRenderer extends MetaballComputeRenderer {
  constructor(renderer, volume) {
    super(renderer, volume);

    const module = this.device.createShaderModule({ code: MetaballRenderPointSource });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.renderer.bindGroupLayouts.frame,
          this.renderer.bindGroupLayouts.metaball
        ]
      }),
      vertex: {
        module,
        buffers: [{
          arrayStride: 12,
          stepMode: 'instance',
          attributes: [{
            shaderLocation: ATTRIB_MAP.POSITION,
            format: 'float32x3',
            offset: 0,

          }],
        }]
      },
      fragment: {
        module,
        targets: [{
          format: this.renderer.renderFormat,
        }]
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: 'uint32',
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

  draw(passEncoder, view) {
    const resource = this.resources[this.drawIndex];

    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(BIND_GROUP.Frame, view.bindGroup);
    passEncoder.setBindGroup(1, this.renderer.bindGroups.metaball);
    passEncoder.setVertexBuffer(0, resource.vertexBuffer);
    passEncoder.drawIndirect(resource.indirectBuffer, 0);
  }
}