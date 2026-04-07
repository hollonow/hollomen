import { NextResponse } from 'next/server'
import { z } from 'zod'
import { v2 as cloudinary } from 'cloudinary'
import { requireAuth } from '@/lib/auth'

const productIdSchema = z.string().regex(/^[A-F0-9]{8}$/i, 'Invalid product_id')

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
})

export async function GET(req: Request) {
  try {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth

    const { searchParams } = new URL(req.url)
    const parsed = productIdSchema.safeParse(searchParams.get('product_id'))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid product_id' }, { status: 400 })
    }

    const product_id = parsed.data
    const prefix = `hollomen/${product_id}/`
    const cdnResult = await cloudinary.api.resources({
      type:         'upload',
      prefix,
      max_results:  100,
      resource_type: 'image',
    })

    const files = (cdnResult.resources ?? []).map((r: { public_id: string; secure_url: string }) => ({
      id:   r.public_id,
      name: r.public_id.split('/').pop() ?? r.public_id,
      url:  r.secure_url,
    }))

    return NextResponse.json({ files })
  } catch (err) {
    console.error('[/api/images]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
