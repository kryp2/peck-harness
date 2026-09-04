Fix `aggregate_successes` in `events.py`.

The function must ignore blank lines, parse each remaining line as JSON, include only records whose `status` is exactly `"ok"`, and sum integer `amount` values by string `kind`. Raise `ValueError` when a nonblank line is invalid JSON or when an included record has a missing or invalid `kind` or `amount`; booleans are not valid amounts. Return keys in alphabetical insertion order. Do not add dependencies or change the public function signature.
