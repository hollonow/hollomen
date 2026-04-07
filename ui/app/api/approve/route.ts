import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updateRow } from '@/lib/supabase'
import { requireAdmin } from '@/lib/auth'

const ApproveSchema = z.object({
  product_id: z.string().regex(/^[A-F0-9]{8}$/i, 'Invalid product_id'),
  action: z.enum(['approve', 'reject', 'rerun']),
  product_name: z.string().max(200).optional(),
  designer_brand: z.string().max(100).optional(),
  product_type: z.string().max(100).optional(),
  material_info:            z.string().max(2000).optional(),
  english_full_translation: z.string().max(5000).optional(),
  english_name_draft:       z.string().max(200).optional(),
  research_sources:         z.string().max(2000).optional(),
})

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const parsed = ApproveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.issues }, { status: 400 })
    }

    const { product_id, product_name, designer_brand, product_type, action,
            material_info, english_full_translation, english_name_draft, research_sources } = parsed.data

    if (action === 'reject') {
      await updateRow(product_id, {
        status: 'SCRAPPED',
        notes: `Rejected via dashboard — ${new Date().toISOString()}`,
      })
      return NextResponse.json({ success: true })
    }

    if (action === 'rerun') {
      const update: Partial<Record<string, unknown>> = {
        status: 'READY_FOR_RESEARCH',
        notes: `Re-queued for research — ${new Date().toISOString()}`,
      }
      if (product_name?.trim())             update.final_product_name        = product_name.trim()
      if (designer_brand?.trim())           update.designer_brand            = designer_brand.trim()
      if (product_type?.trim())             update.product_type              = product_type.trim()
      if (material_info?.trim())            update.material_info             = material_info.trim()
      if (english_full_translation?.trim()) update.english_full_translation  = english_full_translation.trim()
      if (english_name_draft?.trim())       update.english_name_draft        = english_name_draft.trim()
      if (research_sources?.trim())         update.research_sources          = research_sources.trim()
      await updateRow(product_id, update as never)
      return NextResponse.json({ success: true })
    }

    // Default: approve → READY_FOR_SEO
    const hasManualResearch = [material_info, english_full_translation, english_name_draft, research_sources]
      .some(f => f?.trim())

    const update: Partial<Record<string, unknown>> = {
      status: 'READY_FOR_SEO',
      notes: `Approved via dashboard — ${new Date().toISOString()}`,
    }
    if (product_name?.trim())             update.final_product_name        = product_name.trim()
    if (designer_brand?.trim())           update.designer_brand            = designer_brand.trim()
    if (product_type?.trim())             update.product_type              = product_type.trim()
    if (material_info?.trim())            update.material_info             = material_info.trim()
    if (english_full_translation?.trim()) update.english_full_translation  = english_full_translation.trim()
    if (english_name_draft?.trim())       update.english_name_draft        = english_name_draft.trim()
    if (research_sources?.trim())         update.research_sources          = research_sources.trim()
    if (hasManualResearch) {
      update.researched_at           = new Date().toISOString()
      update.source_reputation_score = 1.0
    }

    await updateRow(product_id, update as never)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[/api/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
