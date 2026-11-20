import json
from pathlib import Path

import pytest

from evaluate import evaluate


def test_external_evaluation_adapter():
    payload = json.loads((Path(__file__).resolve().parents[1] / "examples" / "requests.json").read_text())
    result = evaluate(payload)
    assert result["results"][0]["profit_inr"] == 1040
    assert len(result["results"]) == 5
    payload["algorithm"] = "flow"
    assert evaluate(payload)["results"][0]["profit_inr"] == 1040
    payload["requests"][0]["deadline_min"] = 1000
    with pytest.raises(ValueError, match="Deadline"):
        evaluate(payload)
