# whisper-rs-sys 0.11.1 copies its pinned native source into OUT_DIR before CMake.
# Catch native Vulkan initialization exceptions before they cross the Rust ABI.
# Only this generated dependency copy is modified; registry and app data stay intact.
set(_sr_vk_file "${CMAKE_CURRENT_SOURCE_DIR}/ggml/src/ggml-vulkan.cpp")
if(GGML_VULKAN AND EXISTS "${_sr_vk_file}")
  # ggml_vk_instance_init has C linkage but Vulkan-Hpp throws C++ exceptions.
  # /EHc would optimize away the surrounding catch as if that call cannot throw.
  if(MSVC)
    add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:/EHs>" "$<$<COMPILE_LANGUAGE:CXX>:/EHc->")
  endif()
  file(READ "${_sr_vk_file}" _sr_vk_source)
  set(_sr_vk_count_old "int ggml_backend_vk_get_device_count() {\n    return ggml_vk_get_device_count();\n}")
  set(_sr_vk_count_new [=[int ggml_backend_vk_get_device_count() {
    // Stream-Record: missing/unsupported drivers must leave CPU available.
    try {
        return ggml_vk_get_device_count();
    } catch (const std::exception & error) {
        std::cerr << "Stream-Record: Vulkan unavailable, using CPU: " << error.what() << std::endl;
        return 0;
    }
}]=])
  set(_sr_vk_init_old [=[ggml_backend_t ggml_backend_vk_init(size_t dev_num) {
    VK_LOG_DEBUG("ggml_backend_vk_init(" << dev_num << ")");

    ggml_backend_vk_context * ctx = new ggml_backend_vk_context;
    ggml_vk_init(ctx, dev_num);

    ggml_backend_t vk_backend = new ggml_backend {
        /* .guid      = */ ggml_backend_vk_guid(),
        /* .interface = */ ggml_backend_vk_interface,
        /* .device    = */ ggml_backend_reg_dev_get(ggml_backend_vk_reg(), dev_num),
        /* .context   = */ ctx,
    };

    return vk_backend;
}]=])
  set(_sr_vk_init_new [=[ggml_backend_t ggml_backend_vk_init(size_t dev_num) {
    // Stream-Record: keep native exceptions inside the native library.
    if (dev_num >= static_cast<size_t>(ggml_backend_vk_get_device_count())) {
        return nullptr;
    }
    ggml_backend_vk_context * ctx = nullptr;
    try {
        ctx = new ggml_backend_vk_context;
        ggml_vk_init(ctx, dev_num);
        return new ggml_backend {
            /* .guid      = */ ggml_backend_vk_guid(),
            /* .interface = */ ggml_backend_vk_interface,
            /* .device    = */ ggml_backend_reg_dev_get(ggml_backend_vk_reg(), dev_num),
            /* .context   = */ ctx,
        };
    } catch (const std::exception & error) {
        delete ctx;
        std::cerr << "Stream-Record: Vulkan context unavailable, using CPU: " << error.what() << std::endl;
        return nullptr;
    }
}]=])
  set(_sr_vk_buffer_old [=[ggml_backend_buffer_type_t ggml_backend_vk_buffer_type(size_t dev_num) {
    ggml_vk_instance_init();

    VK_LOG_DEBUG("ggml_backend_vk_buffer_type(" << dev_num << ")");

    vk_device dev = ggml_vk_get_device(dev_num);

    return &dev->buffer_type;
}]=])
  set(_sr_vk_buffer_new [=[ggml_backend_buffer_type_t ggml_backend_vk_buffer_type(size_t dev_num) {
    // Stream-Record: model allocation must also support a missing GPU.
    if (dev_num >= static_cast<size_t>(ggml_backend_vk_get_device_count())) {
        return ggml_backend_cpu_buffer_type();
    }
    try {
        vk_device dev = ggml_vk_get_device(dev_num);
        return &dev->buffer_type;
    } catch (const std::exception & error) {
        std::cerr << "Stream-Record: Vulkan buffer unavailable, using CPU: " << error.what() << std::endl;
        return ggml_backend_cpu_buffer_type();
    }
}]=])
  foreach(_sr_vk_part count init buffer)
    string(FIND "${_sr_vk_source}" "${_sr_vk_${_sr_vk_part}_old}" _sr_vk_found)
    if(NOT _sr_vk_found EQUAL -1)
      string(REPLACE "${_sr_vk_${_sr_vk_part}_old}" "${_sr_vk_${_sr_vk_part}_new}" _sr_vk_source "${_sr_vk_source}")
      set(_sr_vk_changed TRUE)
    else()
      string(FIND "${_sr_vk_source}" "${_sr_vk_${_sr_vk_part}_new}" _sr_vk_found)
      if(_sr_vk_found EQUAL -1)
        message(FATAL_ERROR "Vulkan native source changed; revalidate Stream-Record CPU fallback before building")
      endif()
    endif()
  endforeach()
  if(_sr_vk_changed)
    file(WRITE "${_sr_vk_file}" "${_sr_vk_source}")
  endif()
endif()
