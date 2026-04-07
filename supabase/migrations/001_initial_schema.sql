-- =============================================================================
-- HolloEngine: Initial Schema
-- Replaces Google Sheets as the pipeline's Single Source of Truth
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PRODUCTS TABLE
-- One row per product, updated in-place as it moves through the pipeline.
-- Column groupings follow the agent that writes them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (

  -- ── Identity ───────────────────────────────────────────────────────────────
  id                        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id                text        UNIQUE NOT NULL,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),

  -- ── Pipeline Control ───────────────────────────────────────────────────────
  status                    text        NOT NULL DEFAULT 'READY_FOR_SCRAPE',
  manual_override           boolean     DEFAULT false,    -- true = skip all agents
  notes                     text,
  target_store              text,                         -- e.g. hollomen.com

  -- ── Agent 1: Miner ─────────────────────────────────────────────────────────
  source_url                text,
  supplier_id               text        UNIQUE,
  raw_chinese               text,
  english_full_translation  text,
  english_name_draft        text,
  extracted_brand           text,
  material_info             text,
  product_description       text,
  -- Storage (Cloudinary replaces Google Drive)
  storage_folder_url        text,                         -- Cloudinary folder URL
  main_image_id             text,                         -- Cloudinary public_id
  image_count               integer     DEFAULT 0,
  scraped_at                timestamptz,

  -- ── Agent 2: Researcher ────────────────────────────────────────────────────
  designer_brand            text,
  product_type              text,
  final_product_name        text,
  research_sources          text,
  research_source_links     text[],                       -- array, not comma string
  source_reputation_score   numeric(4,3),                 -- 0.000 – 1.000
  researched_at             timestamptz,

  -- ── Agent 3: Voice ─────────────────────────────────────────────────────────
  seo_slug                  text,
  cms_title                 text,                         -- ≤ 60 chars
  cms_body_html             text,
  meta_description          text,                         -- ≤ 160 chars
  faq_json_ld               jsonb,                        -- FAQPage schema
  product_json_ld           jsonb,                        -- Product schema
  extracted_price           numeric(10,2),

  -- ── Agent 4: Optimizer ─────────────────────────────────────────────────────
  webp_image_count          integer     DEFAULT 0,
  viewpoint_labels          jsonb,                        -- {viewpoint: cloudinary_id}
  optimized_at              timestamptz,

  -- ── Agent 5: Publisher ─────────────────────────────────────────────────────
  store_url                 text,                         -- WooCommerce product URL
  wc_product_id             integer,
  published_at              timestamptz
);

-- ---------------------------------------------------------------------------
-- STATUS CONSTRAINT
-- Allows known statuses + any *_FAILED variant (e.g. SCRAPE_FAILED)
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD CONSTRAINT valid_status CHECK (
  status IN (
    'READY_FOR_SCRAPE',
    'READY_FOR_RESEARCH',
    'READY_FOR_SEO',
    'READY_FOR_PUBLISH',
    'NEEDS_REVIEW',
    'APPROVED_FOR_PUBLISH',
    'PENDING_APPROVAL',
    'DISCOVERED',
    'DUPLICATE',
    'INVALID_URL',
    'DISCOVERY_EMPTY',
    'DISCOVERY_FAILED',
    'PUBLISHED',
    'LIVE',
    'SCRAPPED'
  )
  OR status LIKE '%_FAILED'
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- Agents query almost exclusively by status; dashboard filters by store/date.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_products_status        ON products(status);
CREATE INDEX idx_products_supplier_id   ON products(supplier_id);
CREATE INDEX idx_products_target_store  ON products(target_store);
CREATE INDEX idx_products_created_at    ON products(created_at DESC);
CREATE INDEX idx_products_scraped_at    ON products(scraped_at DESC);

-- ---------------------------------------------------------------------------
-- AUTO-UPDATE updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- RUN SESSIONS TABLE
-- One row per agent run. Powers the dashboard run history + live console.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_sessions (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  agent               text        NOT NULL,   -- 'agent1' | 'agent2' | ...
  status              text        NOT NULL DEFAULT 'running',  -- running | completed | failed
  batch_limit         integer,                -- how many products were requested
  started_at          timestamptz DEFAULT now(),
  ended_at            timestamptz,
  duration_seconds    integer,
  products_attempted  integer     DEFAULT 0,
  products_succeeded  integer     DEFAULT 0,
  products_failed     integer     DEFAULT 0,
  error_summary       text[],                 -- short human-readable error list
  notes               text
);

CREATE INDEX idx_run_sessions_agent      ON run_sessions(agent);
CREATE INDEX idx_run_sessions_started_at ON run_sessions(started_at DESC);

-- ---------------------------------------------------------------------------
-- PIPELINE LOGS TABLE
-- Structured log events per product per session. Powers the live console
-- and per-product journey timeline in the dashboard.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_logs (
  id          bigserial   PRIMARY KEY,
  session_id  uuid        REFERENCES run_sessions(id) ON DELETE CASCADE,
  product_id  text,
  agent       text,
  level       text        DEFAULT 'INFO',   -- INFO | WARNING | ERROR
  message     text        NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_pipeline_logs_session   ON pipeline_logs(session_id);
CREATE INDEX idx_pipeline_logs_product   ON pipeline_logs(product_id);
CREATE INDEX idx_pipeline_logs_created   ON pipeline_logs(created_at DESC);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Disabled for now (single-tenant internal tool).
-- Enable and add policies when multi-tenant client login is needed.
-- ---------------------------------------------------------------------------
ALTER TABLE products       DISABLE ROW LEVEL SECURITY;
ALTER TABLE run_sessions   DISABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_logs  DISABLE ROW LEVEL SECURITY;
