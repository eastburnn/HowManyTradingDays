-- estimate_is_stale() reads the clock, so it is stable, not immutable.
alter function public.estimate_is_stale(date, text) stable;
