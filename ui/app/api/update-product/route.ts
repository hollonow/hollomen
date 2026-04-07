import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updateRow } from '@/lib/supabase'
import { requireAdmin } from '@/lib/auth'

const UpdateSchema = z.object({
  product_id:          z.string().regex(/^[A-F0-9]{8}$/i, 'Invalid product_id'),
  cms_title:           z.string().max(200).optional(),
  meta_description:    z.string().max(500).optional(),
  product_description: z.string().max(5000).optional(),
  cms_body_html:       z.string().max(50000).optional(),
})

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const parsed = UpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 })
    }

    const { product_id, ...fields } = parsed.data

    // Only update fields that were actually provided
    const update: Record<string, string> = {}
    if (fields.cms_title           !== undefined) update.cms_title           = fields.cms_title
    if (fields.meta_description    !== undefined) update.meta_description    = fields.meta_description
    if (fields.product_description !== undefined) update.product_description = fields.product_description
    if (fields.cms_body_html       !== undefined) update.cms_body_html       = fields.cms_body_html

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    await updateRow(product_id, update as never)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[/api/update-product]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
