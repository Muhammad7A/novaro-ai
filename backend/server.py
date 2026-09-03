"""
Emergent reverse-proxy for the Nova Explorer Node.js app.

The Emergent ingress routes every /api/* request to this Python service on
port 8001. Nova Explorer is a single Node/Express app that serves both the
API and the static frontend; it runs on port 3000 (started by the `frontend`
supervisor program). This proxy simply forwards whatever it receives to that
Node app, streaming responses so Server-Sent Events (/api/chat) keep working.
"""
import os

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

UPSTREAM = os.environ.get("NOVA_UPSTREAM", "http://127.0.0.1:3000")

app = FastAPI(title="Nova Explorer Proxy")
client = httpx.AsyncClient(base_url=UPSTREAM, timeout=httpx.Timeout(300.0))

# Headers that must not be copied verbatim between hops.
REQ_STRIP = {"host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade"}
RESP_STRIP = {"connection", "keep-alive", "transfer-encoding", "content-length"}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def proxy(path: str, request: Request):
    headers = {k: v for k, v in request.headers.items() if k.lower() not in REQ_STRIP}
    # The Node app trusts these to enforce HTTPS logic and per-IP rate limits.
    headers["x-forwarded-proto"] = request.headers.get("x-forwarded-proto", "https")
    if request.client:
        fwd = request.headers.get("x-forwarded-for")
        headers["x-forwarded-for"] = f"{fwd}, {request.client.host}" if fwd else request.client.host

    body = await request.body()
    upstream_req = client.build_request(
        request.method,
        "/" + path,
        params=request.query_params,
        headers=headers,
        content=body,
    )
    upstream = await client.send(upstream_req, stream=True)

    resp_headers = {k: v for k, v in upstream.headers.items() if k.lower() not in RESP_STRIP}

    async def body_iter():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=resp_headers,
    )
