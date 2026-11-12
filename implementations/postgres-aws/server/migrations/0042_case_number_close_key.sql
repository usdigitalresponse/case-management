-- Case numbers' "close" key, as closeKey in src/billing/caseNumbers.ts: ASCII letters and digits, upper case, no leading zeros.
CREATE FUNCTION case_number_close_key(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN regexp_replace(upper(regexp_replace(value, '[^A-Za-z0-9]+', '', 'g')), '(^|[A-Z])0+([0-9])', '\1\2', 'g');
