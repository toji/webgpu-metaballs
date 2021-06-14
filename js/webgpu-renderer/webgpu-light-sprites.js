// Copyright 2021 Brandon Jones
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

import { BIND_GROUP } from './shaders/common.js';
import { LightSpriteVertexSource, LightSpriteFragmentSource } from './shaders/light-sprite.js';

export class WebGPULightSprites {
  constructor(renderer) {
    this.renderer = renderer;

    const vertexModule = renderer.device.createShaderModule({
      code: LightSpriteVertexSource,
      label: 'Light Sprite Vertex'
    });
    const fragmentModule = renderer.device.createShaderModule({
      code: LightSpriteFragmentSource,
      label: 'Light Sprite Fragment'
    });

    // Setup a render pipeline for drawing the light sprites
    this.pipeline = renderer.device.createRenderPipeline({
      label: `Light Sprite Pipeline`,
      layout: renderer.device.createPipelineLayout({
        bindGroupLayouts: [
          renderer.bindGroupLayouts.frame, // set 0
        ]
      }),
      vertex: {
        module: vertexModule,
        entryPoint: 'vertexMain'
      },
      fragment: {
        module: fragmentModule,
        entryPoint: 'fragmentMain',
        targets: [{
          format: renderer.contextFormat,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one',
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one",
            },
          },
        }],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: 'uint32'
      },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: renderer.depthFormat,
      },
      multisample: {
        count: renderer.sampleCount,
      }
    });
  }

  draw(passEncoder) {
    // Last, render a sprite for all of the lights. This is done using instancing so it's a single
      // call for every light.
      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(BIND_GROUP.Frame, this.renderer.bindGroups.frame);
      passEncoder.draw(4, this.renderer.lightManager.lightCount, 0, 0);
  }
}
