-- ============================================================
-- HolloEngine RLS Policies
-- Run this in the Supabase SQL Editor to lock down tables.
-- ============================================================

-- products table
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_write" ON public.products
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- run_sessions table
ALTER TABLE public.run_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_write" ON public.run_sessions
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- pipeline_logs table
ALTER TABLE public.pipeline_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_write" ON public.pipeline_logs
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
