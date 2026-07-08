import { buildCoverageReport } from './compare'
import { scanApiCalls } from './scan-api-calls'
import { scanHandlers } from './scan-handlers'
import { scanWrapperCalls } from './scan-wrapper-calls'
import type { AnalyzerOptions, CoverageReport } from './types'

export async function analyzeProject(options: AnalyzerOptions): Promise<CoverageReport> {
  const [handlerResult, apiCallResult, wrapperCallResult] = await Promise.all([
    scanHandlers(options),
    scanApiCalls(options),
    scanWrapperCalls(options),
  ])

  return buildCoverageReport({
    handlers: handlerResult.handlers,
    apiCalls: [...apiCallResult.apiCalls, ...wrapperCallResult.apiCalls],
    unsupported: [...handlerResult.unsupported, ...apiCallResult.unsupported, ...wrapperCallResult.unsupported],
  })
}
