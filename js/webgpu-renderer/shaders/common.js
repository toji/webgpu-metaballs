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

import { wgsl } from 'wgsl-preprocessor';

export const ATTRIB_MAP = {
  POSITION: 1,
  NORMAL: 2,
  TANGENT: 3,
  TEXCOORD_0: 4,
  COLOR_0: 5,
};

export const BIND_GROUP = {
  Frame: 0,
  Material: 1,
  Model: 2,
};

export const ProjectionUniformsSize = 144;
export const ProjectionUniforms = /*wgsl*/`
  struct ProjectionUniforms {
    matrix : mat4x4f,
    inverseMatrix : mat4x4f,
    outputSize : vec2f,
    zNear : f32,
    zFar : f32,
  }
  @group(${BIND_GROUP.Frame}) @binding(0) var<uniform> projection : ProjectionUniforms;
`;

export const ViewUniformsSize = 80;
export const ViewUniforms = /*wgsl*/`
  struct ViewUniforms {
    matrix : mat4x4f,
    position : vec3f,
    time : f32,
  }
  @group(${BIND_GROUP.Frame}) @binding(1) var<uniform> view : ViewUniforms;
`;

export const LightUniforms = /*wgsl*/`
  struct Light {
    position : vec3f,
    range : f32,
    color : vec3f,
    intensity : f32,
  }

  struct GlobalLightUniforms {
    ambient : vec3f,
    lightCount : u32,
    lights : array<Light>,
  }
  @group(${BIND_GROUP.Frame}) @binding(2) var<storage> globalLights : GlobalLightUniforms;
`;

export const ModelUniformsSize = 64;
export const ModelUniforms = /*wgsl*/`
  struct ModelUniforms {
    matrix : mat4x4f,
  }
  @group(${BIND_GROUP.Model}) @binding(0) var<uniform> model : ModelUniforms;
`;

export const MaterialUniformsSize = 48;
export const MaterialUniforms = /*wgsl*/`
  struct MaterialUniforms {
    baseColorFactor : vec4f,
    metallicRoughnessFactor : vec2f,
    emissiveFactor : vec3f,
    occlusionStrength : f32,
  }
  @group(${BIND_GROUP.Material}) @binding(0) var<uniform> material : MaterialUniforms;

  @group(${BIND_GROUP.Material}) @binding(1) var defaultSampler : sampler;
  @group(${BIND_GROUP.Material}) @binding(2) var baseColorTexture : texture_2d<f32>;
  @group(${BIND_GROUP.Material}) @binding(3) var normalTexture : texture_2d<f32>;
  @group(${BIND_GROUP.Material}) @binding(4) var metallicRoughnessTexture : texture_2d<f32>;
  @group(${BIND_GROUP.Material}) @binding(5) var occlusionTexture : texture_2d<f32>;
  @group(${BIND_GROUP.Material}) @binding(6) var emissiveTexture : texture_2d<f32>;
`;

const APPROXIMATE_SRGB = false;
export const ColorConversions = wgsl`
#if ${APPROXIMATE_SRGB}
  // linear <-> sRGB approximations
  // see http://chilliant.blogspot.com/2012/08/srgb-approximations-for-hlsl.html
  let GAMMA = 2.2;
  fn linearTosRGB(linear : vec3f) -> vec3f {
    let INV_GAMMA = 1.0 / GAMMA;
    return pow(linear, vec3(INV_GAMMA));
  }

  fn sRGBToLinear(srgb : vec3f) -> vec3f {
    return pow(srgb, vec3(GAMMA));
  }
#else
  // linear <-> sRGB conversions
  fn linearTosRGB(linear : vec3f) -> vec3f {
    if (all(linear <= vec3(0.0031308))) {
      return linear * 12.92;
    }
    return (pow(abs(linear), vec3(1.0/2.4)) * 1.055) - vec3(0.055);
  }

  fn sRGBToLinear(srgb : vec3f) -> vec3f {
    if (all(srgb <= vec3(0.04045))) {
      return srgb / vec3(12.92);
    }
    return pow((srgb + vec3(0.055)) / vec3(1.055), vec3(2.4));
  }
#endif
`;

export const SimpleVertexSource = /*wgsl*/`
  ${ProjectionUniforms}
  ${ViewUniforms}
  ${ModelUniforms}

  @vertex
  fn main(@location(${ATTRIB_MAP.POSITION}) POSITION : vec3f) -> @builtin(position) vec4f {
    return projection.matrix * view.matrix * model.matrix * vec4(POSITION, 1.0);
  }
`;
