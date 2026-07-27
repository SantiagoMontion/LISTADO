-- =============================================================================
-- NOTMID — Permitir eliminar clientes mayoristas
-- Supabase → SQL Editor → Run
-- =============================================================================

DROP POLICY IF EXISTS nm_hub_mayorista_clients_delete ON public.nm_hub_mayorista_clients;
CREATE POLICY nm_hub_mayorista_clients_delete
  ON public.nm_hub_mayorista_clients
  FOR DELETE
  TO authenticated
  USING (public.nm_hub_can_manage_mayorista_clients());

GRANT DELETE ON public.nm_hub_mayorista_clients TO authenticated;

-- También ampliar manage a todos los roles hub (acceso unificado).
CREATE OR REPLACE FUNCTION public.nm_hub_can_manage_mayorista_clients()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.nm_hub_profile_role() IN (
    'admin',
    'lista_creator',
    'taller_1',
    'taller_2',
    'online_1'
  );
$$;
