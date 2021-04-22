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

import { ProjectionUniforms, ViewUniforms, ColorConversions, ATTRIB_MAP } from './common.js';

export const MetaballVertexSource = `
  ${ProjectionUniforms}
  ${ViewUniforms}

  struct VertexInput {
    [[location(${ATTRIB_MAP.POSITION})]] position : vec3<f32>;
    [[location(${ATTRIB_MAP.NORMAL})]] normal : vec3<f32>;
  };

  struct VertexOutput {
    [[location(0)]] worldPosition : vec3<f32>;
    [[location(1)]] normal : vec3<f32>;
    [[location(2)]] flow : vec3<f32>;
    [[builtin(position)]] position : vec4<f32>;
  };

  [[stage(vertex)]]
  fn vertexMain(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.worldPosition = input.position;
    output.normal = input.normal;
    output.flow = vec3<f32>(sin(view.time * 0.0001), cos(view.time * 0.0004), sin(view.time * 0.00007));

    output.position = projection.matrix * view.matrix * vec4<f32>(input.position, 1.0);
    return output;
  }
`;

export const MetaballFragmentSource = `
  ${ColorConversions}

  [[group(1), binding(0)]] var baseSampler : sampler;
  [[group(1), binding(1)]] var baseTexture : texture_2d<f32>;

  struct VertexOutput {
    [[location(0)]] worldPosition : vec3<f32>;
    [[location(1)]] normal : vec3<f32>;
    [[location(2)]] flow : vec3<f32>;
  };

  [[stage(fragment)]]
  fn fragmentMain(input : VertexOutput) -> [[location(0)]] vec4<f32> {
    let normal : vec3<f32> = normalize(input.normal);

    var blending : vec3<f32> = abs(normal);
    blending = normalize(max(blending, vec3<f32>(0.00001, 0.00001, 0.00001))); // Force weights to sum to 1.0
    
    let xTex : vec4<f32> = textureSample(baseTexture, baseSampler, input.worldPosition.yz + input.flow.yz);
    let yTex : vec4<f32> = textureSample(baseTexture, baseSampler, input.worldPosition.xz + input.flow.xz);
    let zTex : vec4<f32> = textureSample(baseTexture, baseSampler, input.worldPosition.xy + input.flow.xy);
    // blend the results of the 3 planar projections.
    let tex : vec4<f32> = xTex * blending.x + yTex * blending.y + zTex * blending.z;

    return vec4<f32>(linearTosRGB(tex.xyz), 1.0);

    //let color : vec3<f32> = linearTosRGB(vec3<f32>(1.0, 0.0, 0.0) + (normal * 0.1));
    //return vec4<f32>(color, 1.0);
  }
`;