// Product row — mirrors the `products` table in Supabase exactly.
// snake_case matches Postgres column names returned by the JS client.
export interface Product {
  // Identity
  id:                         string
  product_id:                 string
  created_at:                 string
  updated_at:                 string

  // Pipeline control
  status:                     string
  manual_override:            boolean
  notes:                      string | null
  target_store:               string | null

  // Agent 1: Miner
  source_url:                 string | null
  supplier_id:                string | null
  raw_chinese:                string | null
  english_full_translation:   string | null
  english_name_draft:         string | null
  extracted_brand:            string | null
  material_info:              string | null
  product_description:        string | null
  storage_folder_url:         string | null   // Cloudinary folder URL
  main_image_id:              string | null   // Cloudinary public_id
  image_count:                number | null
  scraped_at:                 string | null

  // Agent 2: Researcher
  designer_brand:             string | null
  product_type:               string | null
  final_product_name:         string | null
  research_sources:           string | null
  research_source_links:      string[] | null // Postgres text[]
  source_reputation_score:    number | null   // 0.000 – 1.000
  researched_at:              string | null

  // Agent 3: Voice
  seo_slug:                   string | null
  cms_title:                  string | null   // ≤ 60 chars
  cms_body_html:              string | null
  meta_description:           string | null   // ≤ 160 chars
  faq_json_ld:                Record<string, unknown> | null  // jsonb
  product_json_ld:            Record<string, unknown> | null  // jsonb
  extracted_price:            number | null

  // Agent 4: Optimizer
  webp_image_count:           number | null
  viewpoint_labels:           Record<string, string> | null   // {viewpoint: cloudinary_id}
  optimized_at:               string | null

  // Agent 5: Publisher
  store_url:                  string | null
  wc_product_id:              number | null
  published_at:               string | null
}

export interface RunSession {
  id:                 string
  agent:              string
  status:             'running' | 'completed' | 'failed'
  batch_limit:        number | null
  started_at:         string
  ended_at:           string | null
  duration_seconds:   number | null
  products_attempted: number
  products_succeeded: number
  products_failed:    number
  error_summary:      string[] | null
  notes:              string | null
  total_tokens:       number | null
  estimated_cost_usd: number | null
  stop_requested:     boolean | null
}

export interface PipelineLog {
  id:         number
  session_id: string | null
  product_id: string | null
  agent:      string | null
  level:      'INFO' | 'WARNING' | 'ERROR'
  message:    string
  created_at: string
}

export interface Stats {
  total:            number
  pending_approval: number
  needs_review:     number
  failed:           number
  in_progress:      number
  live:             number
}

export interface ApiResponse {
  products: Product[]
  stats:    Stats
}
