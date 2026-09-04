Fix `merge_config` in `config.py`.

Return a deep, independent merge without mutating either input. When both values for a key are dictionaries, merge them recursively. Every other override value replaces the base value completely, including lists and `None`. Keys present in only one input must also be deeply copied so later mutations of the result cannot affect either input. Reject non-dictionary top-level arguments with `TypeError`. Use only the Python standard library and keep the public function signature.
