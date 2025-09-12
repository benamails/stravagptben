#!/usr/bin/env python3
import json
from typing import Dict, Any

INPUT_FILE = "strava_year.json"           # fichier source: tableau d'activités
OUTPUT_FILE = "strava_year_wrapped.json"  # fichier cible: {"activities": [...]}

def coerce_types(activity: Dict[str, Any]) -> Dict[str, Any]:
    """
    Harmonisation légère et non destructive :
    - avg_watts -> float si chaîne numérique
    - comute -> bool (accepte str 0/1/yes/no/true/false, et int)
    - elevation, distance_meter, avg_hr -> float si possible
    """
    out = dict(activity)

    # avg_watts
    if "avg_watts" in out and out["avg_watts"] is not None:
        try:
            out["avg_watts"] = float(out["avg_watts"])
        except (ValueError, TypeError):
            pass

    # comute -> bool
    if "comute" in out:
        v = out["comute"]
        if isinstance(v, str):
            out["comute"] = v.strip().lower() in {"true", "1", "yes", "y"}
        elif isinstance(v, (int, float)):
            out["comute"] = bool(v)
        # si déjà bool, on laisse tel quel

    # elevation
    if "elevation" in out and out["elevation"] is not None:
        try:
            out["elevation"] = float(out["elevation"])
        except (ValueError, TypeError):
            pass

    # distance_meter
    if "distance_meter" in out and out["distance_meter"] is not None:
        try:
            out["distance_meter"] = float(out["distance_meter"])
        except (ValueError, TypeError):
            pass

    # avg_hr
    if "avg_hr" in out and out["avg_hr"] is not None:
        try:
            out["avg_hr"] = float(out["avg_hr"])
        except (ValueError, TypeError):
            pass

    return out

def main():
    # Charger le JSON source (doit être un tableau)
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        src = json.load(f)

    if not isinstance(src, list):
        raise TypeError(f"Le fichier source doit contenir un tableau JSON, trouvé: {type(src).__name__}")

    # Coercions optionnelles (peuvent être désactivées si non souhaitées)
    normalized = [coerce_types(a) for a in src]

    # Écrire dans le format attendu par l’API
    wrapped = {"activities": normalized}

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(wrapped, f, ensure_ascii=False, indent=2)

    print(f"OK: {len(normalized)} activités écrites dans {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
