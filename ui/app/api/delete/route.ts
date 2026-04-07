import { NextResponse } from 'next/server'
import { z } from 'zod'
import { deleteRow, deleteRows } from '@/lib/supabase'
import { v2 as cloudinary } from 'cloudinary'
import { requireAdmin } from '@/lib/auth'

const DeleteSchema = z.union([
  z.object({ product_id: z.string().regex(/^[A-F0-9]{8}$/i, 'Invalid product_id') }),
  z.object({ product_ids: z.array(z.string().regex(/^[A-F0-9]{8}$/i)).min(1).max(500) }),
])

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
})

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const parsed = DeleteSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid product_id(s)' }, { status: 400 })
    }

    const ids: string[] = 'product_ids' in parsed.data
      ? parsed.data.product_ids
      : [parsed.data.product_id]

    // Delete Cloudinary assets in parallel (non-fatal — folders may not exist)
    await Promise.allSettled(
      ids.map(async (product_id) => {
        try {
          await cloudinary.api.delete_resources_by_prefix(`hollomen/${product_id}/`)
          await cloudinary.api.delete_folder(`hollomen/${product_id}`)
        } catch (cdnErr: unknown) {
          const msg = cdnErr instanceof Error ? cdnErr.message : String(cdnErr)
          if (!msg.includes('not found') && !msg.includes("Can't find folder")) {
            console.error(`[/api/delete] Cloudinary error for ${product_id}:`, msg)
          }
        }
      })
    )

    // Delete all rows in one batch query
    let deleted: number
    if (ids.length === 1) {
      await deleteRow(ids[0])
      deleted = 1
    } else {
      deleted = await deleteRows(ids)
    }

    return NextResponse.json({ success: true, deleted })
  } catch (err) {
    console.error('[/api/delete]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
