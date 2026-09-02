REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bootstrap_account(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_generations_today(uuid) FROM PUBLIC, anon;