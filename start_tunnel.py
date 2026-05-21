"""
start_tunnel.py — Cloudflare Quick Tunnel (picofuri-backend) を起動し URL を .env に自動更新する。

PM2 で常時起動:
  pm2 start start_tunnel.py --name picofuri-tunnel
    --interpreter python.exe
    --cwd "C:/Users/Administrator/Desktop/flea-market-monitor"

動作:
  1. server/.env の PORT を読み取り（デフォルト 3001）
  2. cloudflared tunnel --url http://localhost:{PORT} を subprocess で起動
  3. stderr/stdout を監視して https://*.trycloudflare.com の URL を抽出
  4. server/.env の PICOFURI_TUNNEL_URL を新 URL に書き換え（なければ末尾追記）
  5. Telegram に URL 更新を通知
  6. cloudflared プロセスと生死を共にする（終了したら PM2 が再起動）
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
from pathlib import Path

# PM2 on Windows uses CP932; force UTF-8 so emoji in print() don't crash
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import requests
from dotenv import load_dotenv

# ── 設定 ──────────────────────────────────────────────────────
CLOUDFLARED  = r"C:\cloudflared\cloudflared.exe"
ENV_PATH     = Path(__file__).parent / "server" / ".env"
URL_RE       = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
STARTUP_WAIT = 30   # URL 抽出タイムアウト（秒）

load_dotenv(ENV_PATH)
PORT         = int(os.getenv("PORT", "3001"))
BOT_TOKEN    = os.getenv("TELEGRAM_BOT_TOKEN", "")
ADMIN_ID     = os.getenv("TELEGRAM_ADMIN_ID", "")


# ── Telegram 通知 ──────────────────────────────────────────────
def _send_telegram(text: str) -> None:
    if not BOT_TOKEN or not ADMIN_ID:
        return
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        requests.post(url, json={"chat_id": ADMIN_ID, "text": text}, timeout=10)
    except Exception as e:
        print(f"[tunnel] Telegram 送信失敗: {e}", flush=True)


# ── server/.env 更新 ───────────────────────────────────────────
def _update_env(new_url: str) -> None:
    text = ENV_PATH.read_text(encoding="utf-8")
    if "PICOFURI_TUNNEL_URL=" in text:
        text = re.sub(r"PICOFURI_TUNNEL_URL=.*", f"PICOFURI_TUNNEL_URL={new_url}", text)
    else:
        text = text.rstrip("\n") + f"\nPICOFURI_TUNNEL_URL={new_url}\n"
    ENV_PATH.write_text(text, encoding="utf-8")
    print(f"[tunnel] ✅ .env 更新: PICOFURI_TUNNEL_URL={new_url}", flush=True)


# ── ストリーム監視スレッド ──────────────────────────────────────
def _scan_stream(
    stream,
    label: str,
    found_event: threading.Event,
    found_url: list,
) -> None:
    for raw in stream:
        line = raw.rstrip() if isinstance(raw, str) else raw.decode("utf-8", errors="replace").rstrip()
        print(f"[cloudflared/{label}] {line}", flush=True)
        if not found_event.is_set():
            m = URL_RE.search(line)
            if m:
                found_url.append(m.group(0))
                found_event.set()


# ── メイン ────────────────────────────────────────────────────
def main() -> None:
    if not Path(CLOUDFLARED).exists():
        print(f"[tunnel] ❌ cloudflared が見つかりません: {CLOUDFLARED}", flush=True)
        sys.exit(1)

    print(f"[tunnel] 🚀 cloudflared tunnel 起動中... (→ localhost:{PORT})", flush=True)
    proc = subprocess.Popen(
        [CLOUDFLARED, "tunnel", "--url", f"http://localhost:{PORT}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    found_event = threading.Event()
    found_url: list[str] = []

    t_out = threading.Thread(
        target=_scan_stream,
        args=(proc.stdout, "stdout", found_event, found_url),
        daemon=True,
    )
    t_err = threading.Thread(
        target=_scan_stream,
        args=(proc.stderr, "stderr", found_event, found_url),
        daemon=True,
    )
    t_out.start()
    t_err.start()

    if found_event.wait(timeout=STARTUP_WAIT):
        url = found_url[0]
        print(f"[tunnel] 🔗 URL 取得: {url}", flush=True)
        _update_env(url)
        _send_telegram(f"🔗 picofuri-backend トンネルURL更新:\n{url}\n\nAUTOPRO Webhook エンドポイント:\n{url}/api/autopro/purchase")
    else:
        print(f"[tunnel] ⚠️ {STARTUP_WAIT}秒以内に URL を取得できませんでした", flush=True)

    exit_code = proc.wait()
    print(f"[tunnel] cloudflared 終了 (exit={exit_code})", flush=True)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
