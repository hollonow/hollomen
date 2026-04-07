import { NextResponse } from 'next/server'
import cloudinary from 'cloudinary'
import { requireAuth } from '@/lib/auth'

cloudinary.v2.config({
  cloud_name:  process.env.CLOUDINARY_CLOUD_NAME,
  api_key:     process.env.CLOUDINARY_API_KEY,
  api_secret:  process.env.CLOUDINARY_API_SECRET,
})

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(0)} KB`
  return `${bytes} B`
}

export async function GET() {
  try {
    const auth = await requireAuth()
    if (auth instanceof NextResponse) return auth

    const usage = await cloudinary.v2.api.usage()

    return NextResponse.json({
      storage_bytes:    usage.storage?.usage ?? 0,
      storage_fmt:      fmtBytes(usage.storage?.usage ?? 0),
      storage_limit:    usage.storage?.limit ?? null,
      bandwidth_bytes:  usage.bandwidth?.usage ?? 0,
      bandwidth_fmt:    fmtBytes(usage.bandwidth?.usage ?? 0),
      resources:        usage.resources ?? 0,
      transformations:  usage.transformations?.usage ?? 0,
      plan:             usage.plan ?? null,
    })
  } catch (err) {
    console.error('[/api/reports/cloudinary]', err)
    return NextResponse.json({ error: 'Failed to fetch Cloudinary usage' }, { status: 500 })
  }
}
