from seattletransit.state import summarize, _redact


def train(route, delay, predicted=True):
    return {"id": f"{route}{delay}", "route": route, "delay": delay, "predicted": predicted}


def test_summarize():
    trains = [train("100479", 0), train("100479", 400), train("2LINE", -90), train("2LINE", 60),
              train("2LINE", 9999, predicted=False)]  # schedule-only: counted in service, not in stats
    s = summarize(trains)
    assert s["in_service"] == 5
    assert s["all"]["count"] == 4
    assert s["all"]["on_time_pct"] == 50.0          # 0 and 60 on time; 400 late, -90 early
    assert s["routes"]["100479"]["on_time_pct"] == 50.0
    assert s["routes"]["2LINE"]["avg_delay"] == -15
    assert s["worst"][0]["delay"] == 400
    assert sum(s["hist"]["counts"]) == 4
    assert s["hist"]["counts"][0] == 1               # -90s -> clamped into the "<= -2" bin
    assert s["hist"]["counts"][6 - (-2)] == 1          # 400s -> 6 min bin


def test_redact_scrubs_the_key_in_every_url_encoded_form(monkeypatch):
    from seattletransit import config

    key = "sup3r+s3cr3t/valu3=xyz"
    monkeypatch.setattr(config, "OBA_KEY", key)
    # requests' params= encoding is what actually lands in str(e); the others are backstops.
    for tail in ("key=sup3r%2Bs3cr3t%2Fvalu3%3Dxyz&includeStatus=true",   # percent-encoded
                 f"key={key}&includeStatus=true",                          # raw
                 "key=sup3r+s3cr3t/valu3=xyz&includeStatus=true"):         # unencoded
        out = _redact(f"401 Client Error: Unauthorized for url: https://api.x/y.json?{tail}")
        assert "s3cr3t" not in out and "%2B" not in out and key not in out, tail
        assert "includeStatus=true" in out          # rest of the message survives
    assert _redact("no key here") == "no key here"


if __name__ == "__main__":
    test_summarize()
    print("ok")
