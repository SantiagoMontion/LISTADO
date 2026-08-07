-- Allow hub users (Supabase Auth authenticated) to manage tracked_products from /importados-sync
-- Service role (Vercel cron) already bypasses RLS.

ALTER TABLE public.tracked_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tracked_products_select_authenticated ON public.tracked_products;
DROP POLICY IF EXISTS tracked_products_insert_authenticated ON public.tracked_products;
DROP POLICY IF EXISTS tracked_products_update_authenticated ON public.tracked_products;
DROP POLICY IF EXISTS tracked_products_delete_authenticated ON public.tracked_products;

CREATE POLICY tracked_products_select_authenticated
  ON public.tracked_products
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY tracked_products_insert_authenticated
  ON public.tracked_products
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY tracked_products_update_authenticated
  ON public.tracked_products
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY tracked_products_delete_authenticated
  ON public.tracked_products
  FOR DELETE
  TO authenticated
  USING (true);
