"""Backend tests for Novaro deployment adaptation."""
import os
import json
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://3ea54680-0765-44b8-b063-7e921fa89739.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def demo_code():
    r = requests.post(f"{BASE_URL}/api/demo", timeout=30)
    assert r.status_code == 200, f"/api/demo failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    code = data.get("code") or data.get("kode") or data.get("access_code")
    assert code, f"No demo code returned: {data}"
    return str(code)


# --- Health ---
def test_health_ok():
    r = requests.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d.get("ok") is True
    assert d.get("model") == "gemini-2.5-flash"
    assert d.get("aiConfigured") is True
    p = d.get("penyimpanan", {})
    assert p.get("baca") == "ok"
    assert p.get("tulis") == "ok"
    assert p.get("peserta") == 20


# --- Landing page ---
def test_landing_page_has_branding_and_footer():
    r = requests.get(f"{BASE_URL}/", timeout=20)
    assert r.status_code == 200
    html = r.text
    assert "Novaro" in html, "Novaro branding missing"
    assert "Building Indonesia AI Contest by Emergent" in html, "Footer credit missing"


# --- Validator page ---
def test_validasi_page():
    r = requests.get(f"{BASE_URL}/validasi", timeout=20)
    assert r.status_code == 200


# --- Demo login ---
def test_demo_login(demo_code):
    assert demo_code
    # try to fetch dashboard-related endpoint using bearer
    headers = {"Authorization": f"Bearer {demo_code}"}
    r = requests.get(f"{BASE_URL}/api/me", headers=headers, timeout=20)
    # /api/me may or may not exist; accept 200 or 404 but not 401 for a valid demo
    assert r.status_code in (200, 404), f"Unexpected status: {r.status_code} {r.text[:200]}"


# --- AI Checkup ---
def test_checkup_ai(demo_code):
    import time
    headers = {"Authorization": f"Bearer {demo_code}", "Content-Type": "application/json"}
    r = None
    for attempt in range(4):
        r = requests.post(f"{BASE_URL}/api/checkup", headers=headers, json={}, timeout=90)
        if r.status_code == 200:
            break
        if r.status_code == 429:
            time.sleep(6 + attempt * 4)
            continue
        break
    assert r.status_code == 200, f"checkup failed: {r.status_code} {r.text[:400]}"
    data = r.json()
    # Expect AI-generated insight items in Indonesian
    text = json.dumps(data, ensure_ascii=False)
    assert len(text) > 50, f"checkup response too small: {text}"


# --- AI Streaming chat via SSE ---
def test_chat_sse_streams(demo_code):
    headers = {
        "Authorization": f"Bearer {demo_code}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    payload = {"message": "Labaku sebulan berapa?"}
    with requests.post(f"{BASE_URL}/api/chat", headers=headers, json=payload, stream=True, timeout=120) as r:
        assert r.status_code == 200, f"chat status: {r.status_code} body: {r.text[:400]}"
        got_delta = False
        got_done = False
        buffer = ""
        # Read up to ~60s of stream
        for chunk in r.iter_content(chunk_size=None, decode_unicode=True):
            if not chunk:
                continue
            buffer += chunk if isinstance(chunk, str) else chunk.decode("utf-8", errors="ignore")
            if "event: delta" in buffer:
                got_delta = True
            if "event: done" in buffer:
                got_done = True
                break
            if len(buffer) > 200000:
                break
        assert got_delta, f"No 'event: delta' seen in SSE stream. Buffer sample: {buffer[:500]}"
        # Accept either 'done' or fully-streamed content (rate-limit at tail is acceptable)
        assert got_done or buffer.count("event: delta") >= 2, (
            f"Stream ended without 'done' and few deltas. Sample: {buffer[-500:]}"
        )
