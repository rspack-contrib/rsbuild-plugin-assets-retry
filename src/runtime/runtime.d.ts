// Declare types for runtime code
// We use SWC transform to compile runtime code, so we can not import types from other modules
declare type CrossOrigin = import('@rsbuild/core').CrossOrigin;
declare type AssetsRetryHookContext = import('../types.js').AssetsRetryHookContext;
declare type NormalizedRuntimeRetryOptions = import('../types.js').NormalizedRuntimeRetryOptions;

// global variables shared between initialChunkRetry and asyncChunkRetry
var __RB_ASYNC_CHUNKS__: Record<string, boolean>;
var __RETRY_OPTIONS__: NormalizedRuntimeRetryOptions[];
