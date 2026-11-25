export declare const LOCAL_TEST_TIMEOUT_MS: number
export declare const LOCAL_HOOK_TIMEOUT_MS: number
export declare const CI_LIMIT_FACTOR: number
export declare const CI_TEST_TIMEOUT_MS: number
export declare const CI_HOOK_TIMEOUT_MS: number
export declare function slowTestsReporterPath(): string
export declare function scaledTimeout(ms: number, env?: Record<string, string | undefined>): number
export declare function isCi(env?: Record<string, string | undefined>): boolean
export declare function ciTestOptions(env?: Record<string, string | undefined>): {
  testTimeout?: number
  hookTimeout?: number
  reporters?: string[]
}
export declare const LOCAL_ASYNC_UTIL_TIMEOUT_MS: number
export declare const CI_ASYNC_UTIL_TIMEOUT_MS: number
export declare function testingLibraryOptions(env?: Record<string, string | undefined>): { asyncUtilTimeout?: number }
