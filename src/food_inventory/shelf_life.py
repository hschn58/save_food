"""Category inference and shelf-life estimates.

Estimates are deliberately conservative defaults; users can override the
expiry date on any pantry item.
"""

CATEGORIES = (
    "dairy",
    "meat",
    "seafood",
    "produce",
    "bakery",
    "frozen",
    "dry goods",
    "beverages",
    "condiments",
    "other",
)

SHELF_LIFE_DAYS: dict[str, int] = {
    "dairy": 7,
    "meat": 3,
    "seafood": 2,
    "produce": 5,
    "bakery": 4,
    "frozen": 90,
    "dry goods": 180,
    "beverages": 30,
    "condiments": 90,
    "other": 30,
}

# Checked in order; first keyword found in the item name wins. "frozen" is
# first so "frozen chicken" beats the meat keywords.
_KEYWORDS: list[tuple[str, str]] = [
    ("frozen", "frozen"),
    ("ice cream", "frozen"),
    # dairy
    ("milk", "dairy"),
    ("cheese", "dairy"),
    ("yogurt", "dairy"),
    ("butter", "dairy"),
    ("cream", "dairy"),
    ("egg", "dairy"),
    # meat
    ("chicken", "meat"),
    ("beef", "meat"),
    ("pork", "meat"),
    ("turkey", "meat"),
    ("bacon", "meat"),
    ("sausage", "meat"),
    ("ham", "meat"),
    ("steak", "meat"),
    # seafood
    ("fish", "seafood"),
    ("salmon", "seafood"),
    ("shrimp", "seafood"),
    ("tuna", "seafood"),
    ("crab", "seafood"),
    # beverages and condiments come before produce so compound names like
    # "orange juice" or "tomato sauce" resolve to the processed category
    ("melon", "produce"),  # before "water" so watermelon stays produce
    # beverages
    ("juice", "beverages"),
    ("soda", "beverages"),
    ("coffee", "beverages"),
    ("tea", "beverages"),
    ("water", "beverages"),
    ("beer", "beverages"),
    ("wine", "beverages"),
    # condiments
    ("ketchup", "condiments"),
    ("mustard", "condiments"),
    ("mayo", "condiments"),
    ("sauce", "condiments"),
    ("dressing", "condiments"),
    ("salsa", "condiments"),
    ("jam", "condiments"),
    ("jelly", "condiments"),
    ("honey", "condiments"),
    ("syrup", "condiments"),
    # produce
    ("apple", "produce"),
    ("banana", "produce"),
    ("orange", "produce"),
    ("grape", "produce"),
    ("berr", "produce"),
    ("lettuce", "produce"),
    ("spinach", "produce"),
    ("kale", "produce"),
    ("tomato", "produce"),
    ("onion", "produce"),
    ("garlic", "produce"),
    ("carrot", "produce"),
    ("broccoli", "produce"),
    ("potato", "produce"),
    ("pepper", "produce"),
    ("cucumber", "produce"),
    ("avocado", "produce"),
    ("mushroom", "produce"),
    ("lemon", "produce"),
    ("lime", "produce"),
    ("fruit", "produce"),
    ("vegetable", "produce"),
    # bakery
    ("bread", "bakery"),
    ("bagel", "bakery"),
    ("tortilla", "bakery"),
    ("bun", "bakery"),
    ("muffin", "bakery"),
    ("croissant", "bakery"),
    # dry goods
    ("rice", "dry goods"),
    ("pasta", "dry goods"),
    ("flour", "dry goods"),
    ("sugar", "dry goods"),
    ("cereal", "dry goods"),
    ("bean", "dry goods"),
    ("lentil", "dry goods"),
    ("oat", "dry goods"),
    ("nut", "dry goods"),
    ("canned", "dry goods"),
    ("oil", "dry goods"),
    ("salt", "dry goods"),
    ("spice", "dry goods"),
]


def infer_category(name: str) -> str:
    """Guess a category from an item name. Falls back to 'other'."""
    lowered = name.lower()
    for keyword, category in _KEYWORDS:
        if keyword in lowered:
            return category
    return "other"


def shelf_life_days(category: str) -> int:
    """Estimated shelf life in days for a category."""
    return SHELF_LIFE_DAYS.get(category, SHELF_LIFE_DAYS["other"])
