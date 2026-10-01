import 'server-only'
import type { ProcessingErrorKind, TextExtractionMethod } from '@rqi/types'
import { extractDocumentText } from './document-text-extraction'
import { resolveOcrAdapter, OcrAdapterError, type OcrAdapter } from './ocr-adapter'
import {
  runCandidateDocumentExtraction,
  type CandidateExtractionOutcome,
} from '@/lib/ai/parse-candidate-document'
import type { CandidateAIProvider } from '@/lib/ai/candidate-provider'

/**
 * The full deterministic-extraction → OCR-routing → AI-parsing pipeline
 * (Build Phase 6 brief §AI PIPELINE steps 2-8) as one pure, database-free
 * orchestration function. Takes already-downloaded document bytes and
 * returns everything the caller (document-processing-actions.ts) needs to
 * write one complete `candidate_document_processing_jobs` row plus, on
 * success, the `candidate_extracted_fields` rows — this function never
 * touches Supabase itself, so it is fully unit-testable against the real
 * fixture files in test/fixtures/candidate-documents/ without a database.
 */
export interface PipelineResult {
  jobStatus: 'awaiting_review' | 'needs_ocr' | 'failed'
  textExtractionMethod: TextExtractionMethod | null
  extractedText: string | null
  extractedCharCount: number | null
  errorKind: ProcessingErrorKind | null
  /** Always a safe, non-sensitive message — never raw document content (Build Phase 6 brief §SECURITY). */
  errorMessage: string | null
  /** Set only when the AI provider was actually invoked (i.e. text extraction — deterministic or OCR — succeeded first). */
  ai: CandidateExtractionOutcome | null
}

function ocrErrorKind(kind: OcrAdapterError['kind']): ProcessingErrorKind {
  switch (kind) {
    case 'not_configured':
      return 'ocr_not_configured'
    case 'timeout':
      return 'timeout'
    default:
      return 'provider_error'
  }
}

function aiErrorKind(outcome: CandidateExtractionOutcome): ProcessingErrorKind {
  if (outcome.status === 'not_configured') return 'ai_not_configured'
  if (outcome.status === 'rejected_by_validation') return 'validation_failed'
  // status === 'error': the orchestration layer (lib/ai/parse-candidate-
  // document.ts) doesn't preserve the AIProviderError's `kind` on its
  // outcome type (matching lib/ai/extract-requirements.ts's identical
  // ExtractionOutcome shape) — classify from the same fixed, safe message
  // strings lib/ai/*-provider.ts always produces for each kind.
  const message = outcome.errorMessage ?? ''
  if (message.toLowerCase().includes('timed out')) return 'timeout'
  if (message.toLowerCase().includes('could not reach')) return 'network'
  return 'provider_error'
}

export async function runCandidateDocumentProcessingPipeline(params: {
  bytes: Uint8Array
  mimeType: string
  aiProvider?: CandidateAIProvider
  ocrAdapter?: OcrAdapter
}): Promise<PipelineResult> {
  const extraction = await extractDocumentText(params.bytes, params.mimeType)

  if (extraction.status === 'error') {
    return {
      jobStatus: 'failed',
      textExtractionMethod: null,
      extractedText: null,
      extractedCharCount: null,
      errorKind: extraction.errorKind,
      errorMessage: extraction.message,
      ai: null,
    }
  }

  let documentText: string
  let textExtractionMethod: TextExtractionMethod

  if (extraction.status === 'needs_ocr') {
    const adapter = params.ocrAdapter ?? resolveOcrAdapter()
    try {
      const ocrResult = await adapter.recognizeText(params.bytes, params.mimeType)
      documentText = ocrResult.text
      textExtractionMethod = 'ocr'
    } catch (error) {
      const kind = error instanceof OcrAdapterError ? error.kind : 'provider_error'
      const message =
        error instanceof OcrAdapterError
          ? error.message
          : 'OCR processing failed for an unexpected reason.'
      return {
        jobStatus: 'needs_ocr',
        textExtractionMethod: null,
        extractedText: null,
        extractedCharCount: null,
        errorKind: ocrErrorKind(kind),
        errorMessage: message,
        ai: null,
      }
    }
  } else {
    documentText = extraction.text
    textExtractionMethod = 'deterministic'
  }

  const outcome = await runCandidateDocumentExtraction({
    documentText,
    provider: params.aiProvider,
  })

  if (outcome.status === 'success') {
    return {
      jobStatus: 'awaiting_review',
      textExtractionMethod,
      extractedText: documentText,
      extractedCharCount: documentText.length,
      errorKind: null,
      errorMessage: null,
      ai: outcome,
    }
  }

  return {
    jobStatus: 'failed',
    textExtractionMethod,
    extractedText: documentText,
    extractedCharCount: documentText.length,
    errorKind: aiErrorKind(outcome),
    errorMessage: outcome.errorMessage,
    ai: outcome,
  }
}
