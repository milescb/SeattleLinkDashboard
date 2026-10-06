from seattletransit.state import summarize


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


if __name__ == "__main__":
    test_summarize()
    print("ok")
