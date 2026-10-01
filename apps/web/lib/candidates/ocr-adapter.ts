import 'server-only'

/**
 * OCR adapter interface (Build Phase 6 brief §AI PIPELINE step 4: "Route
 * OCR-required documents to a documented adapter").
 *
 * No live OCR provider is integrated in this build — no OCR vendor,
 * credentials, or business decision on which provider to use has been
 * supplied (project engineering rule: "Stop and report blockers when
 * required credentials, business decisions or source data are missing").
 * `NotConfiguredOcrAdapter` is the honest default: it never fabricates
 * extracted text, and always reports the same `ocr_not_configured` outcome
 * the rest of the pipeline already knows how to route to a safe
 * processing-failure UI state (Build Phase 6 brief §UI: "OCR-required
 * state"), mirroring the `AnthropicProvider`/`not_configured` pattern
 * established in lib/ai/extract-requirements.ts for a missing API key.
 *
 * To integrate a real OCR provider later: implement `OcrAdapter` against
 * the chosen vendor's API, wire it in wherever `NotConfiguredOcrAdapter` is
 * currently constructed (the processing-job orchestration, task #40/#41),
 * and gate its use behind an explicit configuration flag the same way
 * `anthropicConfigured` gates the Anthropic provider — never assume a
 * vendor by default.
 */
export interface OcrResult {
  text: string
  /** Best-effort per-page confidence, when the OCR provider reports one; null when unavailable. */
  confidence: number | null
}

export interface OcrAdapter {
  readonly name: string
  recognizeText(bytes: Uint8Array, mimeType: string): Promise<OcrResult>
}

export class OcrAdapterError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_configured' | 'provider_error' | 'timeout',
  ) {
    super(message)
    this.name = 'OcrAdapterError'
  }
}

/**
 * The only `OcrAdapter` implementation present in this build. Always
 * throws `OcrAdapterError` with kind `not_configured` — it performs no
 * network call and reads no document bytes, so a scanned CV is never
 * silently dropped or guessed at.
 */
export class NotConfiguredOcrAdapter implements OcrAdapter {
  readonly name = 'not-configured'

  async recognizeText(): Promise<OcrResult> {
    throw new OcrAdapterError(
      'OCR processing is not available: no OCR provider is configured for this deployment.',
      'not_configured',
    )
  }
}

/**
 * Resolves the OCR adapter to use. Always returns `NotConfiguredOcrAdapter`
 * in this build — kept as its own function (rather than inlining the class)
 * so a future real adapter can be wired in behind a configuration check
 * here without callers changing.
 */
export function resolveOcrAdapter(): OcrAdapter {
  return new NotConfiguredOcrAdapter()
}
