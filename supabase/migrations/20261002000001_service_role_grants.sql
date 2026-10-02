-- The project has "Automatically expose new tables" disabled, so new objects
-- get no API-role privileges at all — including service_role, which the job
-- runner and the site use. Grant it everything, now and for future objects.
-- anon and authenticated stay unprivileged (see the schema migration).

grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute        on all functions in schema public to service_role;

alter default privileges in schema public grant all     on tables    to service_role;
alter default privileges in schema public grant all     on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
