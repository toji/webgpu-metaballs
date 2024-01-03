// NO LONGER USED. Leaving it here for a bit just in case I need to reference it
// but this shim is no longer used by any of my samples, including webgpu-metaballs.
// It was required at one point in time, but Firefox's WebGPU implementation has
// made great strides since then, and it's no longer necessary.

// Mozilla's implementation has not yet updated from endPass() to end()
if (!('end' in GPURenderPassEncoder.prototype)) {
  GPURenderPassEncoder.prototype.end = GPURenderPassEncoder.prototype.endPass;
}

if (!('end' in GPUComputePassEncoder.prototype)) {
  GPUComputePassEncoder.prototype.end = GPUComputePassEncoder.prototype.endPass;
}

if (!('getPreferredCanvasFormat' in navigator.gpu)) {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  navigator.gpu.getPreferredCanvasFormat = function() {
    return isMobile ? 'rgba8unorm' : 'bgra8unorm';
  };
}

// Applies various patches to WebGPU inputs to make them more compatible with
// Mozilla's implementation
if (navigator.userAgent.indexOf("Firefox") > 0) {

  const MESSAGE_STYLE = {
    'info': {
      icon: 'ℹ️',
      logFn: console.info,
    },
    'warning': {
      icon: '⚠️',
      logFn: console.warn,
    },
    'error': {
      icon: '⛔',
      logFn: console.error,
    }
  }

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


    // Mozilla's implementation doesn't appear to echo shader compilation errors to the console by
    // default. So install a shim that does that for us.
    const shaderModule = oldCreateShaderModule.call(this, descriptor);

    shaderModule.compilationInfo().then((info) => {
      if (!info.messages.length) {
        return;
      }

      const messageCount = {
        error: 0,
        warning: 0,
        info: 0,
      };

      for (const message of info.messages) {
        messageCount[message.type] += 1;
      }

      if (messageCount.error == 0 && validationError) {
        messageCount.error = 1;
      }

      const label = shaderModule.label;
      let groupLabel = (label ? `"${label}"` : 'Shader') +
          ' returned compilation messages:';
      for (const type in messageCount) {
        if (messageCount[type] > 0) {
          groupLabel += ` ${messageCount[type]}${MESSAGE_STYLE[type].icon}`;
        }
      }

      if (messageCount.error == 0) {
        console.groupCollapsed(groupLabel);
      } else {
        console.group(groupLabel);
      }

      for (const message of info.messages) {
        const type = message.type;
        MESSAGE_STYLE[type].logFn(message.message);
      }

      console.groupEnd();
    });

    return shaderModule;
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

  // Mozilla's implementation doesn't expose the canvas attribute on the context.
  const oldGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const context = oldGetContext.apply(this, args);
    if (args[0] == 'webgpu') {
      context.canvas = this; // TODO: Make this read only
    }
    return context;
  }

  // Mozilla's implementation still requires that configure be called on every canvas resize.
  const contextObservers = {};
  const oldConfigure = GPUCanvasContext.prototype.configure;
  GPUCanvasContext.prototype.configure = function (descriptor) {
    const context = this;

    if (!contextObservers[context]) {
      contextObservers[context] = new MutationObserver(function(mutations) {
        let needsReconfigure = false;
        for (const mutation of mutations) {
          if (mutation.attributeName == 'width' || mutation.attributeName == 'height') {
            needsReconfigure = true;
          }
        }
        if (needsReconfigure) {
          oldConfigure.call(context, descriptor);
        }
      });
    }

    contextObservers[context].observe(context.canvas, { attributes: true });

    oldConfigure.call(context, descriptor);
  };

  const oldUnconfigure = GPUCanvasContext.prototype.unconfigure;
  GPUCanvasContext.prototype.unconfigure = function (descriptor) {
    if (contextObservers[this]) {
      contextObservers[this].disconnect();
    }

    oldUnconfigure.call(this, descriptor);
  };
}