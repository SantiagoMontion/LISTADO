-- Pending OOS por variante NotMid: exige 2 chequeos antes de escribir 0.
-- Forma: { "<notmid_variant_id>": "<ISO timestamptz de 1ª señal>" }
ALTER TABLE public.tracked_products
  ADD COLUMN IF NOT EXISTS oos_pending JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tracked_products.oos_pending IS
  'Mapa notmidVariantId → ISO de primera señal OOS confiable. Solo tras ~8min se escribe 0.';
