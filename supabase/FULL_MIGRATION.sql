-- =============================================================================
-- HolloEngine: FULL ONE-SHOT MIGRATION
-- Run this ONCE in Supabase SQL Editor → New Query → Run All
-- Client project: sedhrimkgtoumegosubc.supabase.co
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PRODUCTS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (

  -- Identity
  id                        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id                text        UNIQUE NOT NULL,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now(),

  -- Pipeline Control
  status                    text        NOT NULL DEFAULT 'READY_FOR_SCRAPE',
  manual_override           boolean     DEFAULT false,
  notes                     text,
  target_store              text,

  -- Agent 1: Miner
  source_url                text,
  supplier_id               text        UNIQUE,
  raw_chinese               text,
  english_full_translation  text,
  english_name_draft        text,
  extracted_brand           text,
  material_info             text,
  product_description       text,
  storage_folder_url        text,
  main_image_id             text,
  image_count               integer     DEFAULT 0,
  scraped_at                timestamptz,

  -- Agent 2: Researcher
  designer_brand            text,
  product_type              text,
  final_product_name        text,
  research_sources          text,
  research_source_links     text[],
  source_reputation_score   numeric(4,3),
  researched_at             timestamptz,

  -- Agent 3: Voice
  seo_slug                  text,
  cms_title                 text,
  cms_body_html             text,
  meta_description          text,
  faq_json_ld               jsonb,
  product_json_ld           jsonb,
  extracted_price           numeric(10,2),

  -- Agent 4: Optimizer
  webp_image_count          integer     DEFAULT 0,
  viewpoint_labels          jsonb,
  optimized_at              timestamptz,

  -- Agent 5: Publisher
  store_url                 text,
  wc_product_id             integer,
  published_at              timestamptz
);

-- Status constraint — all pipeline statuses including claiming + failure states
ALTER TABLE products DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE products ADD CONSTRAINT valid_status CHECK (status IN (
  'DISCOVERED',
  'READY_FOR_SCRAPE',   'SCRAPING',
  'READY_FOR_RESEARCH', 'RESEARCHING',
  'NEEDS_REVIEW',
  'READY_FOR_SEO',      'WRITING_SEO',
  'READY_FOR_PUBLISH',  'OPTIMIZING',
  'PUBLISHED',          'PUBLISHING',
  'PENDING_APPROVAL',
  'SCRAPPED',
  'SCRAPE_FAILED',
  'RESEARCH_FAILED',
  'SEO_FAILED',
  'OPTIMIZE_FAILED',
  'PUBLISH_FAILED'
));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_status       ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_supplier_id  ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_created_at   ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_scraped_at   ON products(scraped_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. RUN SESSIONS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_sessions (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  agent               text        NOT NULL,
  status              text        NOT NULL DEFAULT 'running',
  batch_limit         integer,
  started_at          timestamptz DEFAULT now(),
  ended_at            timestamptz,
  duration_seconds    integer,
  products_attempted  integer     DEFAULT 0,
  products_succeeded  integer     DEFAULT 0,
  products_failed     integer     DEFAULT 0,
  errors              text[],
  notes               text,
  -- Cost tracking (Agents 2, 3, 4)
  total_tokens        integer     DEFAULT 0,
  estimated_cost_usd  decimal(10,4) DEFAULT 0,
  -- Graceful stop signal
  stop_requested      boolean     DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_run_sessions_agent      ON run_sessions(agent);
CREATE INDEX IF NOT EXISTS idx_run_sessions_started_at ON run_sessions(started_at DESC);

-- -----------------------------------------------------------------------------
-- 3. PIPELINE LOGS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        REFERENCES run_sessions(id) ON DELETE CASCADE,
  product_id  text,
  agent       text,
  level       text        DEFAULT 'INFO',
  message     text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_logs_agent_created ON pipeline_logs(agent, created_at);
CREATE INDEX IF NOT EXISTS pipeline_logs_session       ON pipeline_logs(session_id, created_at);
CREATE INDEX IF NOT EXISTS pipeline_logs_product       ON pipeline_logs(product_id);

-- -----------------------------------------------------------------------------
-- 4. PROFILES TABLE (auth + role management)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid        REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email      text        NOT NULL,
  full_name  text,
  role       text        NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
  invited_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
CREATE POLICY "Authenticated users can view profiles"
  ON public.profiles FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
CREATE POLICY "Admins can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (
    auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin')
  );

DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin')
  );

-- Auto-create profile on user invite/signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'viewer')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 5. RLS — products, run_sessions, pipeline_logs
--    Authenticated users (agents + dashboard) can read and write.
--    Service role key bypasses RLS entirely (used by Python agents).
-- -----------------------------------------------------------------------------
ALTER TABLE public.products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_write" ON public.products;
CREATE POLICY "authenticated_read_write" ON public.products
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "authenticated_read_write" ON public.run_sessions;
CREATE POLICY "authenticated_read_write" ON public.run_sessions
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "authenticated_read_write" ON public.pipeline_logs;
CREATE POLICY "authenticated_read_write" ON public.pipeline_logs
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- =============================================================================
-- AFTER RUNNING THIS SCRIPT:
-- 1. Go to Authentication → Users → Invite user → enter your admin email
-- 2. Accept the invite email
-- 3. Run this to grant admin role:
--    UPDATE public.profiles SET role = 'admin' WHERE email = 'your@email.com';
-- =============================================================================
