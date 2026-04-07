/**
 * Shared status and brand display utilities.
 * All UI components must use these functions — never render raw Supabase values directly.
 * Status label map is per DESIGN.md §8.
 */

const STATUS_LABELS: Record<string, string> = {
  // Miner
  READY_FOR_SCRAPE:       'QUEUED',
  SCRAPING:               'SCRAPING',
  // Researcher
  READY_FOR_RESEARCH:     'RESEARCHING',
  RESEARCHING:            'RESEARCHING',
  // Review gate
  NEEDS_REVIEW:           'REVIEW',
  // Voice
  READY_FOR_SEO:          'SEO',
  WRITING_SEO:            'SEO',
  // Optimizer
  READY_FOR_OPTIMIZATION: 'OPTIMIZING',
  READY_FOR_PUBLISH:      'PUBLISHING',
  OPTIMIZING:             'OPTIMIZING',
  // Publisher
  PUBLISHED:              'OPTIMIZED',
  PUBLISHING:             'PUBLISHING',
  // Done
  PENDING_APPROVAL:       'IN STORE',
  LIVE:                   'LIVE',
  COMPLETE:               'LIVE',
  // Terminal
  REJECTED:               'REJECTED',
  DUPLICATE:              'DUPLICATE',
  SCRAPPED:               'SCRAPPED',
  DISCOVERED:             'DISCOVERED',
}

/**
 * Maps a raw Supabase status string to its display label per DESIGN.md §8.
 * All *_FAILED statuses → 'FAILED'. Unknown statuses fall back to the raw value.
 */
export function statusLabel(raw: string | null | undefined): string {
  if (!raw) return '—'
  if (raw.includes('FAILED')) return 'FAILED'
  return STATUS_LABELS[raw] ?? raw
}

/**
 * Strips CJK (Chinese/Japanese/Korean) characters from a brand string
 * when a Latin equivalent exists in the same string.
 *
 * Examples:
 *   "普拉达PRADA" → "PRADA"
 *   "GUCCI古奇"   → "GUCCI"
 *   "普拉达"       → "普拉达"  (no Latin present — keep original)
 *   "PRADA"        → "PRADA"   (unchanged)
 */
export function cleanBrand(brand: string | null | undefined): string | null {
  if (!brand) return null
  // Remove CJK Unified Ideographs (U+2E80–U+9FFF) and CJK Compatibility Ideographs (U+F900–U+FAFF)
  const latin = brand.replace(/[\u2E80-\u9FFF\uF900-\uFAFF]/g, '').trim()
  // Only use the stripped version if Latin/ASCII characters remain
  return latin || brand
}
