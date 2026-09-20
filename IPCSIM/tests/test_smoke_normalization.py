from ipc_core.app.serial.protocol.parser import normalize_smoke_value


def test_normalize_vietnamese_yes_no_values():
    assert normalize_smoke_value('Có') == 1
    assert normalize_smoke_value('Không') == 0


def test_normalize_boolean_and_numeric_values():
    assert normalize_smoke_value(True) == 1
    assert normalize_smoke_value(False) == 0
    assert normalize_smoke_value('1') == 1
    assert normalize_smoke_value('0') == 0
