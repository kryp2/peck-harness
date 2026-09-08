"""Small pagination helper used by the Peck Bench fixture."""


def page(items: list[str], page_number: int, page_size: int) -> list[str]:
    """Return one 1-indexed page and reject invalid page arguments."""
    if page_number < 1 or page_size < 1:
        raise ValueError("page_number and page_size must be positive")
    start = page_number * page_size
    return items[start:start + page_size]
