"""Sales report CLI: summarize and export sales rows from a JSON file."""
import json
import sys

DEFAULT_DATA = "data/sales.json"


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def summary(rows):
    totals = {}
    for row in rows:
        totals[row["region"]] = totals.get(row["region"], 0) + row["amount"]
    return totals


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print("usage: report.py summary [DATA_FILE]")
        return 0 if len(argv) >= 2 else 2
    command = argv[1]
    path = argv[2] if len(argv) > 2 else DEFAULT_DATA
    if command == "summary":
        for region, total in sorted(summary(load(path)).items()):
            print(f"{region}: {total}")
        return 0
    print(f"unknown command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
