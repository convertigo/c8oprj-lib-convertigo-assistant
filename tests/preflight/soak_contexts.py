#!/usr/bin/env python3
"""Engine-context soak test: the reads a Tigo run makes for minutes must not pile up engine contexts.

For --minutes (default 10) against one conversation of the Studio, in parallel threads:
  - Tigo tabs: AgentReadResponseRouter as the page sends it (its per-tab __context first, the SDK one after);
  - Assistant -> Bridge: agent_events under the stable name the Assistant gives it
    (studio_assistant_events_<hash of handle and caller session>);
  - run pilot: agent_events straight on the Bridge with an admin session and a context of its own.
Every 30 s it counts the engine contexts (admin connections.List). PASS when the count stays flat (growth <=
--tolerance) once each poller has made its own context (12 s warm-up). A short control phase first sends --control reads with a new context name each, the faf4271
regression, and expects the count to grow by as much: it proves the probe sees a leak.

Usage: python3 tests/preflight/soak_contexts.py [--port 18086] [--minutes 10] [--thread agent-...] [--json out.json]
Reads only: no message is sent, no agent turn starts. The Studio of a supervised run (port 18110) is refused.
"""

import argparse
import collections
import hashlib
import http.cookiejar
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

PROTECTED_PORTS = {18110}


class Client:
    """One browser or pilot: its own cookie jar, signed in as the Studio admin."""

    def __init__(self, base, user="admin", password="admin"):
        self.base = base
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.post("/admin/services/engine.Authenticate", [("authType", "login"), ("authUserName", user), ("authPassword", password)])

    def post(self, path, fields, timeout=60):
        data = urllib.parse.urlencode(fields).encode()
        try:
            with self.op.open(urllib.request.Request(self.base + path, data=data), timeout=timeout) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")
        except Exception as e:  # timeouts and resets count as failures, they do not stop the soak
            return 0, str(e)

    def contexts(self):
        code, text = self.post("/admin/services/connections.List", [])
        names = re.findall(r'contextName="([^"]*)"', text)
        return code, names

    def stale(self):
        """Contexts idle for longer than their own timeout, still listed (the engine never removed them)."""
        _, text = self.post("/admin/services/connections.List", [])
        out = []
        for m in re.finditer(r'<connection [^>]*>', text):
            tag = m.group(0)
            idle = re.search(r'contextInactivityTime="([^"/]*)/\s*([^"]*)"', tag)
            name = re.search(r'contextName="([^"]*)"', tag)
            if idle and name and seconds(idle.group(1)) > seconds(idle.group(2)) > 0:
                out.append((name.group(1), idle.group(1).strip()))
        return out


def seconds(text):
    """'15h2min26s' -> 54146."""
    total = 0
    for value, unit in re.findall(r"(\d+)\s*(h|min|s)", text or ""):
        total += int(value) * {"h": 3600, "min": 60, "s": 1}[unit]
    return total


def family(name):
    for prefix in ("studio_tigo_read_", "studio_agent_router_", "studio_assistant_events_", "studio_soak_driver_",
                   "studio_soak_control_", "studio_mcp", "studio_lib_ConvertigoMCP", "studio_lib_ConvertigoAssistant",
                   "studio_lib_ConvertigoAgentBridge"):
        if name.startswith(prefix):
            return prefix.rstrip("_")
    return "other"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=18086)
    ap.add_argument("--allow-port", type=int, action="append", default=[])
    ap.add_argument("--minutes", type=float, default=10)
    ap.add_argument("--thread", default="", help="conversation id (default: the most recent one of the Studio)")
    ap.add_argument("--tabs", type=int, default=2)
    ap.add_argument("--control", type=int, default=10, help="reads with a new context each, to prove the probe (0 skips)")
    ap.add_argument("--tolerance", type=int, default=2)
    ap.add_argument("--json", default="")
    o = ap.parse_args()
    if o.port in PROTECTED_PORTS and o.port not in o.allow_port:
        raise SystemExit(f"port {o.port} is a protected Studio (supervised run); pass --allow-port {o.port} to force")
    base = f"http://localhost:{o.port}/convertigo"

    browser, pilot = Client(base), Client(base)
    code, listing = browser.post("/projects/lib_ConvertigoAssistant/.json", [("__sequence", "AgentListConversations")])
    conversations = (json.loads(listing).get("result") or {}).get("conversations") or [] if code == 200 else []
    conv = next((c for c in conversations if c.get("conversationId") == o.thread), None) if o.thread else \
        (sorted(conversations, key=lambda c: c.get("updatedAt") or 0)[-1] if conversations else None)
    if not conv:
        raise SystemExit(f"no conversation to read (HTTP {code}); create one in Tigo on this Studio or pass --thread")
    thread, run_id = conv["conversationId"], conv.get("lastRunId") or ""
    handle = conv.get("handle") or thread
    print(f"conversation {thread} ({conv.get('provider')}, {conv.get('status')}), run {run_id}")

    stats = collections.Counter()
    errors = collections.Counter()
    stop = threading.Event()

    def page_tab(n):
        context = f"studio_tigo_read_{int(time.time() * 1000)}_{n}{abs(hash(thread)) % 1000000}"
        while not stop.is_set():
            code, text = browser.post("/projects/lib_ConvertigoAssistant/.json", [
                ("__sequence", "AgentReadResponseRouter"), ("__context", context), ("threadid", thread), ("runid", run_id),
                ("provider", conv.get("provider") or "claude"), ("targetProject", ""), ("userId", "studio"),
                ("agentBridgeOperational", "true"), ("waitMs", "0"), ("__context", "sdk_appended_%d" % n)], timeout=90)
            stats["page read"] += 1
            if code != 200 or '"error"' in text[:400] and "agent_bridge" in text[:400]:
                errors[f"page read HTTP {code}"] += 1
            stop.wait(2)

    events_ctx = "studio_assistant_events_" + hashlib.sha1((handle + "|soak").encode()).hexdigest()[:8]

    def assistant_events():
        while not stop.is_set():
            code, _ = browser.post("/projects/lib_ConvertigoAgentBridge/.json", [
                ("__sequence", "agent_events"), ("__context", events_ctx), ("handle", handle), ("cursor", "0"),
                ("limit", "100"), ("waitMs", "0")])
            stats["assistant agent_events"] += 1
            if code != 200:
                errors[f"assistant agent_events HTTP {code}"] += 1
            stop.wait(2)

    def run_pilot():
        context = f"studio_soak_driver_{int(time.time())}"
        while not stop.is_set():
            code, _ = pilot.post("/projects/lib_ConvertigoAgentBridge/.json", [
                ("__sequence", "agent_events"), ("__context", context), ("handle", handle), ("cursor", "0"),
                ("limit", "50"), ("waitMs", "0")])
            stats["pilot agent_events"] += 1
            if code != 200:
                errors[f"pilot agent_events HTTP {code}"] += 1
            stop.wait(5)

    rows = []
    code, start_names = browser.contexts()
    if code != 200:
        raise SystemExit(f"connections.List answered HTTP {code}")
    print(f"contexts at start: {len(start_names)}")

    # Control: a new context per read must show up as growth, else the probe is blind.
    control_ok = None
    if o.control:
        for i in range(o.control):
            browser.post("/projects/lib_ConvertigoAgentBridge/.json", [
                ("__sequence", "agent_events"), ("__context", f"studio_soak_control_{int(time.time() * 1000)}_{i}"),
                ("handle", handle), ("cursor", "0"), ("waitMs", "0")])
        _, names = browser.contexts()
        grown = len(names) - len(start_names)
        control_ok = grown >= o.control - 1
        rows.append({"check": "control: a new context per read is visible", "status": "PASS" if control_ok else "FAIL",
                     "detail": f"{o.control} reads with new context names -> +{grown} contexts"})
        print(f"[{'ok  ' if control_ok else 'FAIL'}] control: +{grown} contexts after {o.control} reads with new names")
        start_names = names

    threads = [threading.Thread(target=page_tab, args=(i,), daemon=True) for i in range(o.tabs)]
    threads += [threading.Thread(target=assistant_events, daemon=True), threading.Thread(target=run_pilot, daemon=True)]
    for t in threads:
        t.start()
    # Each poller makes its own stable context on its first read: measure from there.
    time.sleep(12)
    _, warm = browser.contexts()
    rows.append({"check": "warm-up: one context per poller", "status": "INFO",
                 "detail": f"{len(warm) - len(start_names):+d} contexts for {len(threads)} pollers"})
    print(f"warm-up: {len(warm) - len(start_names):+d} contexts for {len(threads)} pollers")
    start_names = warm
    samples = []
    t0 = time.time()
    end = t0 + o.minutes * 60
    while True:
        _, names = browser.contexts()
        fam = collections.Counter(family(n) for n in names)
        samples.append({"t": round(time.time() - t0), "total": len(names), "families": dict(fam)})
        print(f"  t+{samples[-1]['t']:>4}s contexts {len(names):>4}  reads {sum(stats.values()):>5}  "
              + " ".join(f"{k}={v}" for k, v in sorted(fam.items())), flush=True)
        if time.time() >= end:
            break
        time.sleep(min(30, max(1, end - time.time())))
    stop.set()
    for t in threads:
        t.join(timeout=95)
    _, end_names = browser.contexts()

    growth = len(end_names) - len(start_names)
    before = collections.Counter(family(n) for n in start_names)
    after = collections.Counter(family(n) for n in end_names)
    by_family = {k: after[k] - before[k] for k in set(before) | set(after) if after[k] != before[k]}
    flat = growth <= o.tolerance
    peak = max(s["total"] for s in samples) - len(start_names)
    rows.append({"check": "engine contexts stay flat", "status": "PASS" if flat else "FAIL",
                 "detail": f"{len(start_names)} -> {len(end_names)} ({growth:+d}, peak {peak:+d}) over {o.minutes:g} min, "
                           f"{sum(stats.values())} reads ({dict(stats)}); growth by family {by_family or 'none'}"})
    rows.append({"check": "reads answer", "status": "PASS" if not errors else "FAIL",
                 "detail": dict(errors) or "no HTTP error"})
    stale = browser.stale()
    if stale:
        fams = collections.Counter(family(n) for n, _ in stale)
        rows.append({"check": "contexts idle past their timeout, still listed", "status": "INFO",
                     "detail": f"{len(stale)} of {len(end_names)} ({dict(fams)}); the oldest idle {max(stale, key=lambda x: seconds(x[1]))[1]}: "
                               "in the Studio every new studio_ context name stays until the engine stops"})
    print()
    for r in rows:
        print(f"[{ {'PASS': 'ok  ', 'INFO': 'info'}.get(r['status'], 'FAIL') }] {r['check']} -- {r['detail']}")
    if o.json:
        with open(o.json, "w") as f:
            json.dump({"conversation": thread, "rows": rows, "samples": samples}, f, indent=1)
    sys.exit(0 if all(r["status"] in ("PASS", "INFO") for r in rows) else 1)


if __name__ == "__main__":
    main()
