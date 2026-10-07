# whisper-rs-sys forwards CMAKE_* variables, so inject this after project().
# Avoid specializing native code for the CI runner; the x64 baseline retains AVX2.
set(GGML_NATIVE OFF CACHE BOOL "Build without host CPU specialization" FORCE)
include("${CMAKE_CURRENT_LIST_DIR}/vulkan-cpu-fallback.cmake")
