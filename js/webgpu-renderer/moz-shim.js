
// Mozilla's implementation has not yet updated from endPass() to end()
if (!('end' in GPURenderPassEncoder.prototype)) {
  GPURenderPassEncoder.prototype.end = GPURenderPassEncoder.prototype.endPass;
}

if (!('end' in GPUComputePassEncoder.prototype)) {
  GPUComputePassEncoder.prototype.end = GPUComputePassEncoder.prototype.endPass;
}

// Applies various patches to WebGPU inputs to make them more compatible with
// Mozilla's implementation
if (navigator.userAgent.indexOf("Firefox") > 0) {

  const oldCreateShaderModule = GPUDevice.prototype.createShaderModule;
  GPUDevice.prototype.createShaderModule = function (descriptor) {
    // Search and replace several symbols to ensure compat
    descriptor.code = descriptor.code
        .replaceAll('vec4f', 'vec4<f32>')
        .replaceAll('vec3f', 'vec3<f32>')
        .replaceAll('vec2f', 'vec2<f32>')
        .replaceAll('vec4u', 'vec4<u32>')
        .replaceAll('vec3u', 'vec3<u32>')
        .replaceAll('vec2u', 'vec2<u32>')
        .replaceAll('mat4x4f', 'mat4x4<f32>');
        // TODO: More. Probably with a more general regex.

    return oldCreateShaderModule.call(this, descriptor);
  };

  function patchPipelineAutoLayout(name) {
    const oldPipelineMethod = GPUDevice.prototype[name];
    GPUDevice.prototype[name] = function (descriptor) {
      // Mozilla's implementation requires the layout to be undefined in order
      // to get the 'auto' functionality.
      if (descriptor.layout == 'auto') {
        delete descriptor.layout;
      }
      return oldPipelineMethod.call(this, descriptor);
    }
  }
  patchPipelineAutoLayout('createRenderPipeline');
  patchPipelineAutoLayout('createRenderPipelineAsync');
  patchPipelineAutoLayout('createComputePipeline');
  patchPipelineAutoLayout('createComputePipelineAsync');


  const oldBeginRenderPass = GPUCommandEncoder.prototype.beginRenderPass;
  GPUCommandEncoder.prototype.beginRenderPass = function (descriptor) {
    // Mozilla's implementation still uses an older form of attachment dictionaries.
    if (descriptor.colorAttachments) {
      for (const attachment of descriptor.colorAttachments) {
        if (attachment.loadOp == 'clear') {
          attachment.loadValue = attachment.clearValue || [0, 0, 0, 0];
        } else {
          attachment.loadValue = 'load';
        }
      }
    }

    if (descriptor.depthStencilAttachment) {
      const attachment = descriptor.depthStencilAttachment;
      if (attachment.depthLoadOp == 'load') {
        attachment.depthLoadValue = 'load';
      } else {
        attachment.depthLoadValue = attachment.depthClearValue || 1.0;
      }

      if (!attachment.depthStoreOp) {
        attachment.depthStoreOp = 'discard';
      }

      if (attachment.stencilClearValue == 'load') {
        attachment.stencilLoadValue = 'load';
      } else {
        attachment.stencilLoadValue = attachment.stencilClearValue || 0.0;
      }

      if (!attachment.stencilStoreOp) {
        attachment.stencilStoreOp = 'discard';
      }
    }

    return oldBeginRenderPass.call(this, descriptor);
  };
}