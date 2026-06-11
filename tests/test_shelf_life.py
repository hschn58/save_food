"""Category inference and shelf-life defaults."""

from food_inventory.shelf_life import SHELF_LIFE_DAYS, infer_category, shelf_life_days


def test_common_items_get_sensible_categories():
    assert infer_category("Whole Milk") == "dairy"
    assert infer_category("chicken breast") == "meat"
    assert infer_category("baby spinach") == "produce"
    assert infer_category("sourdough bread") == "bakery"
    assert infer_category("basmati rice") == "dry goods"
    assert infer_category("orange juice") == "beverages"


def test_frozen_beats_other_keywords():
    assert infer_category("frozen chicken") == "frozen"


def test_unknown_falls_back_to_other():
    assert infer_category("mystery snack") == "other"


def test_every_category_has_a_shelf_life():
    for category, days in SHELF_LIFE_DAYS.items():
        assert days > 0, category


def test_unknown_category_falls_back_to_other():
    assert shelf_life_days("nonsense") == SHELF_LIFE_DAYS["other"]
