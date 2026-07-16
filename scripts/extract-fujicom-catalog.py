#!/usr/bin/env python3
"""Build a structured, searchable product-specification catalog from FUJICOM's PDF.

This is an import tool, not application runtime code.  It keeps the source facts
next to carefully parsed fields so the product search can be expanded without
having to re-read the PDF.  Values are only normalised when the source wording is
unambiguous; all other source lines are still retained in ``sourceFacts``.
"""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import pdfplumber


HEBREW = re.compile(r"[\u0590-\u05ff]")
MODEL_RE = re.compile(r"\b(?:FJ|IT)-[A-Z0-9]+(?:[A-Z0-9-]*)\b", re.I)
NUMBER_RE = r"(\d+(?:[.,]\d+)?)"

# Installation drawings in the final pages are useful documents, but not a
# reliable source for the commercial model's product attributes.
LAST_PRODUCT_PAGE = 71

# The price list omits the trailing IC code on these three models, while the
# catalog prints the same base model with it.  Keep this as an explicitly
# labelled variant match, never as an "exact" match.
MODEL_VARIANTS = {
    "FJNF513XBF": "FJNF513XBFIC",
    "FJNF514DXBF": "FJNF514DXBFIC",
    "FJNF516WBF": "FJNF516WBFIC",
}


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def sku_key(value: object) -> str:
    return re.sub(r"[^A-Z0-9]", "", clean(value).upper())


def logical_word(value: str) -> str:
    """pdfplumber exposes visual-order Hebrew words; reverse Hebrew tokens."""
    value = clean(value)
    return value[::-1] if HEBREW.search(value) else value


def canonical_model(value: str) -> str:
    return clean(value).upper().replace("–", "-").replace("—", "-")


def number(value: str):
    value = clean(value).replace(",", ".")
    parsed = float(value)
    return int(parsed) if parsed.is_integer() else parsed


def append_unique(items: list[str], value: str) -> None:
    value = clean(value)
    if value and value not in items:
        items.append(value)


def extract_logical_lines(page) -> list[dict]:
    words = page.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False)
    buckets: dict[float, list[dict]] = defaultdict(list)
    for word in words:
        buckets[round(float(word["top"]), 1)].append(word)

    lines = []
    for top, row in sorted(buckets.items()):
        sorted_words = sorted(row, key=lambda item: item["x0"], reverse=True)
        text = clean(" ".join(logical_word(item["text"]) for item in sorted_words))
        if text:
            lines.append(
                {
                    "top": top,
                    "x0": min(item["x0"] for item in row),
                    "x1": max(item["x1"] for item in row),
                    "text": text,
                    "words": row,
                }
            )
    return lines


def is_product_anchor(line: dict) -> list[str]:
    # A real data card has "דגם" next to the model.  This avoids matching a
    # decorative product name printed next to an image or a contents listing.
    if "דגם" not in line["text"]:
        return []
    return [canonical_model(value) for value in MODEL_RE.findall(line["text"])]


def source_facts_for_anchor(page_lines: list[dict], anchors: list[dict], anchor: dict) -> list[str]:
    """Return the lines inside a model card's x/y bounds, in visual reading order."""
    # More than one card can be stacked in the same physical column.  Cluster
    # those anchors before calculating column boundaries; otherwise one card's
    # model label would cut its neighbour's value text in half.
    clusters: list[list[dict]] = []
    for item in sorted(anchors, key=lambda value: value["center"]):
        if not clusters or abs(item["center"] - sum(entry["center"] for entry in clusters[-1]) / len(clusters[-1])) > 95:
            clusters.append([item])
        else:
            clusters[-1].append(item)
    cluster_index = next(index for index, cluster in enumerate(clusters) if anchor in cluster)
    centers = [sum(item["center"] for item in cluster) / len(cluster) for cluster in clusters]
    left = 0 if cluster_index == 0 else (centers[cluster_index - 1] + centers[cluster_index]) / 2
    right = 1191 if cluster_index == len(clusters) - 1 else (centers[cluster_index + 1] + centers[cluster_index]) / 2
    same_column = clusters[cluster_index]

    # A page can contain two vertically stacked cards in the same column.
    below = [
        item["top"]
        for item in same_column
        # Variants of the same card are normally printed only 10–20 points
        # apart (black/white/stainless).  A new vertical card starts much lower.
        if item is not anchor and item["top"] > anchor["top"] + 50 and abs(item["center"] - anchor["center"]) < 95
    ]
    bottom = min(below) - 4 if below else 800

    facts: list[str] = []
    for line in page_lines:
        if line["top"] < anchor["top"] - 3 or line["top"] > bottom:
            continue
        column_words = [
            word
            for word in line["words"]
            if (word["x0"] + word["x1"]) / 2 >= left and (word["x0"] + word["x1"]) / 2 <= right
        ]
        if not column_words:
            continue
        text = clean(" ".join(logical_word(word["text"]) for word in sorted(column_words, key=lambda value: value["x0"], reverse=True)))
        if any(noise in text for noise in ("לקוח יקר", "בסוף הקטלוג", "סקיצת המידות", "כל הזכויות שמורות")):
            continue
        if text and text not in facts:
            facts.append(text)
    return facts


def first_match(pattern: str, text: str, flags=re.I):
    found = re.search(pattern, text, flags)
    return found.group(1) if found else None


def extract_dimensions(text: str) -> dict:
    values = {}
    labels = {
        "widthCm": r"רוחב\s*[:\-]?\s*" + NUMBER_RE + r"\s*(?:ס[\"׳״']?מ|cm)",
        "heightCm": r"גובה\s*[:\-]?\s*" + NUMBER_RE + r"\s*(?:ס[\"׳״']?מ|cm)",
        "depthCm": r"עומק\s*[:\-]?\s*" + NUMBER_RE + r"\s*(?:ס[\"׳״']?מ|cm)",
    }
    for field, pattern in labels.items():
        found = first_match(pattern, text)
        if found is not None:
            values[field] = number(found)
    return values


def derive_category(description: str) -> str:
    description = clean(description)
    categories = (
        ("טלוויזיה", ("TV", "טלוויז")),
        ("מיקרוגל", ("מיקרוגל",)),
        ("תנור", ("תנור",)),
        ("קולט אדים", ("קולט",)),
        ("כיריים", ("כיריים",)),
        ("מדיח כלים", ("מדיח",)),
        ("מכונת כביסה", ("מכונת כביסה", "מ.כביסה",)),
        ("מייבש כביסה", ("מייבש",)),
        ("מקרר", ("מקרר",)),
        ("מקפיא", ("מקפיא",)),
    )
    lowered = description.lower()
    for name, terms in categories:
        if any(term.lower() in lowered for term in terms):
            return name
    return ""


def colors_from_text(text: str) -> list[str]:
    palette = {
        "שחור": "שחור",
        "לבן": "לבן",
        "שמנת": "שמנת",
        "כסוף": "כסוף",
        "נירוסטה": "נירוסטה",
        "אפור": "אפור",
        "זהב": "זהב",
        "כחול": "כחול",
        "ירוק": "ירוק",
        "זכוכית שחורה": "זכוכית שחורה",
        "זכוכית לבנה": "זכוכית לבנה",
        "שחור מט": "שחור מט",
    }
    matched = []
    for token in sorted(palette, key=len, reverse=True):
        if token not in text:
            continue
        # "זכוכית שחורה" is more precise than the nested "שחור".
        if any(token in existing for existing in matched):
            continue
        matched.append(token)
    return [palette[token] for token in matched]


def structured_fields(facts: list[str], description: str, sku: str) -> dict:
    # In several RTL cards the value and its label are separate visual lines
    # (for example "3000W" immediately above "הספק").  Keep the original
    # source facts untouched, while adding label/value pairs for parsing.
    paired_facts = []
    label_re = re.compile(r"(?:ברקוד|מידות|נפח|דירוג|הספק|תוכניות|תכניות|צריכת מים|טווח טמפרטורה)")
    for index, fact in enumerate(facts):
        if label_re.search(fact):
            if index:
                paired_facts.append(f"{fact} {facts[index - 1]}")
            if index + 1 < len(facts):
                paired_facts.append(f"{fact} {facts[index + 1]}")
    text = clean(" ".join(facts + paired_facts + [description]))
    attributes: dict = {}
    model_positions = [index for index, fact in enumerate(facts) if sku_key(sku) in sku_key(fact)]
    barcode_locations = [
        (index, barcode)
        for index, fact in enumerate(facts)
        for barcode in re.findall(r"\b(\d{10,14})\b", fact)
    ]
    selected_barcode_lines = []
    barcodes = []
    for position in model_positions:
        options = [
            (index, barcode)
            for index, barcode in barcode_locations
            if abs(index - position) <= 4
        ]
        if not options:
            continue
        index, barcode = min(options, key=lambda option: (abs(option[0] - position), 0 if option[0] < position else 1))
        if barcode not in barcodes:
            barcodes.append(barcode)
            selected_barcode_lines.append(facts[index])
    if not barcodes:
        barcodes = re.findall(r"ברקוד\s*[:\-]?\s*(\d{10,14})", text)
    local_text = clean(" ".join(selected_barcode_lines + [facts[index] for index in model_positions]))
    if barcodes:
        attributes["barcodes"] = list(dict.fromkeys(barcodes))

    dimensions = extract_dimensions(text)
    if dimensions:
        attributes["dimensionsCm"] = dimensions

    capacities = {}
    capacity_patterns = {
        "totalLiters": r"נפח\s+כללי\s*[:\-]?\s*" + NUMBER_RE + r"\s*ליטר",
        "fridgeLiters": r"נפח\s+תא\s+המזון\s*[:\-]?\s*" + NUMBER_RE + r"\s*ליטר",
        "freezerLiters": r"נפח\s+תא\s+ההקפאה\s*[:\-]?\s*" + NUMBER_RE + r"\s*ליטר",
        "ovenLiters": r"נפח\s+תא\s+האפייה\s*[:\-]?\s*" + NUMBER_RE + r"\s*ליטר",
        "bottleCount": NUMBER_RE + r"\s*בקבוקים",
        "placeSettings": NUMBER_RE + r"\s*מערכות\s+(?:כלים|הדחה)",
        "washKg": NUMBER_RE + r"\s*(?:ק[\"׳״']?ג|kg)",
    }
    for field, pattern in capacity_patterns.items():
        found = first_match(pattern, text)
        if found is not None:
            capacities[field] = number(found)

    # The card sometimes names only "נפח 25 ליטר".  It remains unambiguous
    # for a single product card, but we only promote it when no detailed volume
    # exists above.
    if not any(key.endswith("Liters") for key in capacities):
        found = first_match(r"(?:נפח|קיבולת)\s*[:\-]?\s*" + NUMBER_RE + r"\s*ליטר", text)
        if found is not None:
            capacities["totalLiters"] = number(found)
    category = derive_category(description)
    if not any(key.endswith("Liters") for key in capacities) and category in {"מקרר", "מקפיא", "מיקרוגל", "תנור"}:
        found = first_match(NUMBER_RE + r"\s*ליטר", description)
        if found is not None:
            capacities["ovenLiters" if category == "תנור" else "totalLiters"] = number(found)
    if capacities:
        attributes["capacities"] = capacities

    performance = {}
    patterns = {
        "energyRating": r"דירוג\s+ה?אנרגטי\s*[:\-]?\s*([A-G](?:\+{1,3})?)\b",
        "powerW": r"(?:הספק|עוצמת\s+המיקרוגל)\s*[:\-]?\s*" + NUMBER_RE + r"\s*W\b",
        "programCount": r"(?:מס[׳'\"]?\s*)?(?:תוכניות|תכניות)(?:\s+בישול)?\s*[:\-]?\s*" + NUMBER_RE + r"\s*(?:תוכניות|תכניות)",
        "noiseDb": NUMBER_RE + r"\s*dB\b",
        "waterConsumptionLiters": r"צריכת\s+מים\s*[:\-]?\s*" + NUMBER_RE + r"\s*(?:ליטר|L)\b",
        "spinRpm": NUMBER_RE + r"\s*(?:סל[\"׳״']?ד|rpm)\b",
        "airflowM3h": NUMBER_RE + r"\s*(?:מ[\"׳״']?ק|m³)\s*(?:/|ל)\s*(?:שעה|h)",
    }
    for field, pattern in patterns.items():
        found = first_match(pattern, text)
        if found is not None:
            performance[field] = number(found) if field != "energyRating" else found.upper()
    temperature = re.search(NUMBER_RE + r"\s*[°º]?\s*-\s*" + NUMBER_RE + r"\s*[°º]?\s*C", text, re.I)
    if temperature and ("טמפרטורה" in text or "°" in temperature.group(0)):
        performance["temperatureRangeC"] = {"min": number(temperature.group(1)), "max": number(temperature.group(2))}
    screen_size = first_match(r"גודל\s+מסך\s*[:\-]?\s*" + NUMBER_RE + r"\s*[\"״]", text)
    if screen_size is not None:
        performance["screenSizeInches"] = number(screen_size)
    resolution = re.search(r"(\d{3,4})\s*[xX]\s*(\d{3,4})", text)
    if resolution and ("רזולוציה" in text or "HD" in text or "4K" in text):
        performance["resolutionPixels"] = {"width": int(resolution.group(1)), "height": int(resolution.group(2))}
    if performance:
        attributes["performance"] = performance

    display_dimensions = {}
    for label, field in (("ללא מעמד", "withoutStand"), ("כולל מעמד", "withStand")):
        found = re.search(label + r"\s*[:\-]?\s*(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)", text)
        if found:
            # The catalogue prints these in its own W×D×H order.  Preserve the
            # order explicitly instead of guessing from the orientation.
            display_dimensions[field] = {
                "sourceOrder": "width×depth×height",
                "widthMm": number(found.group(1)),
                "depthMm": number(found.group(2)),
                "heightMm": number(found.group(3)),
            }
    if display_dimensions:
        attributes["displayDimensionsMm"] = display_dimensions

    weight = first_match(r"משקל\s*(?:נטו)?\s*[:\-]?\s*" + NUMBER_RE + r"\s*(?:ק[\"׳״']?ג|kg)", text)
    if weight is not None:
        attributes["weightKg"] = number(weight)

    # Colour and barcode are identity facts.  Prefer the price-list description
    # and the few lines next to this exact model so a multi-colour card does
    # not attach all sibling variants to every item.
    colors = colors_from_text(clean(f"{description} {local_text}"))
    if colors:
        attributes["colors"] = colors
    return attributes


def description_only_attributes(sku: str, description: str) -> dict:
    # These models are not printed as exact model cards in this edition of the
    # manufacturer catalog.  Keep the facts actually present in the price list,
    # but never infer dimensions, power or other catalogue specs from a sibling.
    facts = [clean(description)] if clean(description) else []
    attributes = structured_fields(facts, description, sku)
    return {
        "schemaVersion": 1,
        "source": {
            "document": "FUJICOMCatalog_2026.pdf",
            "match": "description_only",
            "pages": [],
            "note": "לא נמצא דגם זהה בקטלוג היצרן; נשמרו רק נתונים שהופיעו במחירון.",
        },
        "identity": {"model": sku},
        "classification": {"category": derive_category(description)},
        **attributes,
        "sourceFacts": facts,
        "searchSummary": clean(f"{sku} {description}"),
        "searchText": clean(f"{sku} {description}"),
    }


def build_attribute(sku: str, description: str, candidate: dict | None, match: str = "exact_model") -> dict:
    if not candidate:
        return description_only_attributes(sku, description)

    facts = candidate["facts"]
    attributes = structured_fields(facts, description, sku)
    # The model printed in the card is an identity fact even when the OCR does
    # not pick its barcode or a field from the same row.
    feature_lines = [
        fact
        for fact in facts
        if not re.search(r"^(?:דגם|ברקוד|מידות|נפח|דירוג\s+אנרגטי|הספק)\b", fact)
    ]
    summary_parts = [sku, description]
    category = derive_category(description)
    if category:
        summary_parts.append(category)
    if attributes.get("dimensionsCm"):
        dims = attributes["dimensionsCm"]
        summary_parts.append(" ".join(f"{key}:{value} ס\"מ" for key, value in dims.items()))
    if attributes.get("capacities"):
        summary_parts.append(" ".join(f"{key}:{value}" for key, value in attributes["capacities"].items()))
    if attributes.get("colors"):
        summary_parts.extend(attributes["colors"])
    search_text = clean(" ".join(summary_parts + facts))
    return {
        "schemaVersion": 1,
        "source": {
            "document": "FUJICOMCatalog_2026.pdf",
            "match": match,
            "pages": [candidate["page"]],
            **({"catalogModel": candidate["model"], "note": "שם הדגם במחירון הוא וריאנט מקוצר של הדגם בקטלוג."} if match == "catalog_variant" else {}),
        },
        "identity": {"model": sku},
        "classification": {"category": category},
        **attributes,
        "features": feature_lines,
        "sourceFacts": facts,
        "searchSummary": clean(" | ".join(summary_parts)),
        "searchText": search_text,
    }


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: extract-fujicom-catalog.py CATALOG.pdf products.json catalog-attributes.json", file=sys.stderr)
        return 2
    pdf_path, products_path, output_path = map(Path, sys.argv[1:])
    product_data = json.loads(products_path.read_text())
    products = product_data.get("products", product_data)
    products_by_model = {sku_key(item.get("sku")): item for item in products if sku_key(item.get("sku"))}
    candidates: dict[str, list[dict]] = defaultdict(list)
    catalog_keys_needed = set(products_by_model) | set(MODEL_VARIANTS.values())

    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            if page_number > LAST_PRODUCT_PAGE:
                break
            lines = extract_logical_lines(page)
            page_anchors = []
            all_words = [word for line in lines for word in line["words"]]
            for word in all_words:
                model = canonical_model(logical_word(word["text"]))
                key = sku_key(model)
                if not MODEL_RE.fullmatch(model):
                    continue
                # The PDF offsets the RTL "דגם" label by a fraction of a line
                # from its model value.  Treat words in the same visual row as
                # one card anchor instead of requiring an identical y bucket.
                has_model_label = any(
                    abs(float(peer["top"]) - float(word["top"])) <= 13
                    and "דגם" in logical_word(peer["text"])
                    for peer in all_words
                )
                if not has_model_label:
                    continue
                center = (word["x0"] + word["x1"]) / 2
                anchor = {"key": key, "model": model, "top": round(float(word["top"]), 1), "center": center}
                if not any(item["key"] == key and abs(item["top"] - anchor["top"]) < 5 and abs(item["center"] - anchor["center"]) < 5 for item in page_anchors):
                    page_anchors.append(anchor)
            # TV cards and a few product tables print the model without the
            # word "דגם".  Use an exact model only when this model did not
            # already have a labelled card on the same page.
            labelled_keys = {item["key"] for item in page_anchors}
            fallback_by_key: dict[str, list[dict]] = defaultdict(list)
            for word in all_words:
                model = canonical_model(logical_word(word["text"]))
                key = sku_key(model)
                if key in labelled_keys or not MODEL_RE.fullmatch(model):
                    continue
                center = (word["x0"] + word["x1"]) / 2
                anchor = {"key": key, "model": model, "top": round(float(word["top"]), 1), "center": center}
                if not any(item["key"] == key and abs(item["top"] - anchor["top"]) < 5 and abs(item["center"] - anchor["center"]) < 5 for item in fallback_by_key[key]):
                    fallback_by_key[key].append(anchor)
            for key, options in fallback_by_key.items():
                # A model can be printed next to a photo and again in the real
                # technical card.  Prefer the occurrence followed by the most
                # technical labels, so the decorative copy never creates a
                # false extra column boundary for another product.
                def technical_score(anchor):
                    return sum(
                        1
                        for peer in all_words
                        if anchor["top"] - 4 <= float(peer["top"]) <= anchor["top"] + 260
                        and abs(((peer["x0"] + peer["x1"]) / 2) - anchor["center"]) <= 200
                        and re.search(r"ברקוד|מידות|נפח|דירוג|הספק|תכונ|תיאור|גודל", logical_word(peer["text"]))
                    )
                page_anchors.append(max(options, key=technical_score))
            if not page_anchors:
                continue
            for anchor in page_anchors:
                if anchor["key"] not in catalog_keys_needed:
                    continue
                facts = source_facts_for_anchor(lines, page_anchors, anchor)
                # Count independent kinds of technical facts; decorative cards
                # often have only a model name and barcode.
                quality = sum(
                    bool(re.search(pattern, " ".join(facts), re.I))
                    for pattern in (r"ברקוד", r"מידות", r"נפח", r"דירוג", r"הספק", r"תוכניות", r"מערכות")
                )
                if facts:
                    candidates[anchor["key"]].append({"page": page_number, "model": anchor["model"], "facts": facts, "quality": quality})

    attributes = {}
    exact = 0
    for product in products:
        sku = clean(product.get("sku"))
        key = sku_key(sku)
        description = clean(product.get("description"))
        options = candidates.get(key, [])
        match = "exact_model"
        if not options and key in MODEL_VARIANTS:
            options = candidates.get(MODEL_VARIANTS[key], [])
            match = "catalog_variant"
        candidate = max(options, key=lambda item: (item["quality"], len(" ".join(item["facts"])))) if options else None
        if candidate:
            exact += match == "exact_model"
        attributes[key] = build_attribute(sku, description, candidate, match)

    output = {
        "schemaVersion": 1,
        "generatedAt": date.today().isoformat(),
        "source": {"document": pdf_path.name, "productPages": [1, LAST_PRODUCT_PAGE]},
        "coverage": {
            "products": len(products),
            "exactCatalogModels": exact,
            "variantCatalogModels": sum(1 for item in attributes.values() if item["source"]["match"] == "catalog_variant"),
            "descriptionOnlyModels": sum(1 for item in attributes.values() if item["source"]["match"] == "description_only"),
        },
        "items": attributes,
    }
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(output["coverage"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
