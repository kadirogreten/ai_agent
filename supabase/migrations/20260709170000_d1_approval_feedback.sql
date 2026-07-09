-- PR-D1d: Onay geri beslemesi policy seed'leri.

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'selfreflect.rejection_min', '3'::jsonb,
  'approval_queue red + reviewer_note eşiği — bu sayıda red sonrası CEO sinyali.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'selfreflect.rejection_min' AND owner_user_id IS NULL
);

INSERT INTO public.policy_settings (owner_user_id, key, value, description)
SELECT NULL, 'selfreflect.rejection_cooldown_hours', '24'::jsonb,
  'Aynı persona/playbook için onay red sinyali cooldown (saat).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.policy_settings
  WHERE key = 'selfreflect.rejection_cooldown_hours' AND owner_user_id IS NULL
);

NOTIFY pgrst, 'reload schema';
