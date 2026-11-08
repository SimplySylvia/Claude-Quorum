---
type: llm
weight: 2
---

PASS if the reply reports, as an [IMPORTANT] finding, that `test_export_uses_data_file` would pass on the
old code because it passes `data/sales.json`, the same file as the default, so it can't tell whether
DATA_FILE is honored; and suggests testing with a different file.
FAIL otherwise.
