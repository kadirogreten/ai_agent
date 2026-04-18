GRANT EXECUTE ON FUNCTION claim_run_request() TO service_role;

CREATE POLICY run_requests_service_role_all ON run_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

