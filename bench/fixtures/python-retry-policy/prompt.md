Fix `retry_delays` in `retry.py`.

`attempts` is the total number of request attempts, so at most `attempts - 1` delays are returned. Retry status 408, 429, and every 5xx status; do not retry other statuses. Delays use exponential backoff beginning at `base_seconds` and are capped at `cap_seconds`. Reject booleans and otherwise require: integer status 100–599, integer attempts of at least 1, and finite positive numeric delay values. Do not add dependencies or change the public function signature.
