-- NOTMID — Permitir a admin insertar/actualizar pedidos despachados (sobrescribir por día)
-- Ejecutar después de nm_hub_dispatched_orders.sql
-- Útil si el RPC falla o como respaldo del cliente.

DROP POLICY IF EXISTS nm_hub_dispatched_insert_admin ON public.nm_hub_dispatched_orders;
CREATE POLICY nm_hub_dispatched_insert_admin
  ON public.nm_hub_dispatched_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (public.nm_hub_profile_role() = 'admin');

DROP POLICY IF EXISTS nm_hub_dispatched_update_admin ON public.nm_hub_dispatched_orders;
CREATE POLICY nm_hub_dispatched_update_admin
  ON public.nm_hub_dispatched_orders
  FOR UPDATE
  TO authenticated
  USING (public.nm_hub_profile_role() = 'admin')
  WITH CHECK (public.nm_hub_profile_role() = 'admin');

GRANT INSERT, UPDATE ON public.nm_hub_dispatched_orders TO authenticated;
