"""Select and drive a Cosma Codex launcher. Keep the ce-work and ce-optimize copies identical."""

import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys


class LauncherError(Exception):
    pass


def configured_launcher():
    if os.environ.get("CE_CODEX_MANAGED") == "off":
        return None
    override = os.environ.get("CE_CODEX_MANAGED_LAUNCHER")
    if override:
        launcher = Path(override).expanduser().absolute()
    else:
        record = Path.home() / ".config/cosma/codex-agent-launcher"
        try:
            record.lstat()
        except FileNotFoundError:
            return None
        launcher = Path(record.read_text(encoding="utf-8").rstrip("\r\n"))
        if not launcher.is_absolute():
            raise LauncherError(f"record must contain an absolute path: {record}")
    if not launcher.is_file():
        raise LauncherError(f"missing: {launcher}")
    if launcher.suffix != ".py" and not os.access(launcher, os.X_OK):
        raise LauncherError(f"is not executable: {launcher}")
    return launcher


def diagnostic(error):
    print("managed Codex launcher " + " ".join(str(error).splitlines()), file=sys.stderr)


def read_reply(proc, command):
    if proc.returncode:
        raise LauncherError(f"{command} exited {proc.returncode}")
    try:
        value = json.loads(proc.stdout)
    except ValueError:
        value = None
    if not isinstance(value, dict):
        raise LauncherError(f"{command} returned invalid JSON")
    return value


def run_job(args):
    launcher = [args.launcher]
    if Path(args.launcher).suffix == ".py":
        launcher[:0] = [sys.executable, "-B"]

    def call(*argv):
        # Keep the launcher commands alive across a signal to the adapter
        # group so start can return its job id and stop can verify cleanup.
        return subprocess.run(
            [*launcher, *argv],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            encoding="utf-8",
            errors="replace",
            start_new_session=True,
        )

    interrupted = None

    def on_signal(signum, _frame):
        nonlocal interrupted
        interrupted = signum

    for name in ("SIGTERM", "SIGINT", "SIGHUP"):
        if sig := getattr(signal, name, None):
            signal.signal(sig, on_signal)

    start_argv = ["start", "--cwd", args.cwd, "--brief-file", args.brief_file]
    if args.model:
        start_argv.extend(("--model", args.model))
    if args.effort:
        start_argv.extend(("--effort", args.effort))

    active_job = None
    failure_exit = 2
    try:
        started = call(*start_argv)
        job = started.stdout.strip()
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", job):
            raise LauncherError(f"start exited {started.returncode} without a valid job id")
        if started.returncode == 0:
            active_job = job
            failure_exit = 1
            while not interrupted:
                status = read_reply(call("wait", job, "--max-secs", "1"), "wait").get("status")
                if status in ("completed", "failed", "interrupted"):
                    active_job = None
                    break
                if status not in ("starting", "running"):
                    raise LauncherError("wait returned an unknown job status")
        if interrupted:
            return 128 + interrupted

        # A failed start can still return an id with a persisted report.
        result = call("result", job)
        report = read_reply(result, "result")
        sys.stdout.write(result.stdout)
        exit_status = report.get("exit_status")
        if type(exit_status) is not int:
            raise LauncherError("result did not report an integer exit_status")
        if started.returncode or exit_status:
            failure = report.get("failure")
            if isinstance(failure, dict) and failure.get("cause"):
                raise LauncherError(f"{failure.get('stage') or 'job failed'}: {failure['cause']}")
            raise LauncherError(f"job exited {exit_status or started.returncode}")
        return 0
    except (LauncherError, OSError) as error:
        diagnostic(error)
        return failure_exit
    finally:
        if active_job:
            try:
                stopped = call("stop", active_job)
                if stopped.returncode:
                    diagnostic(f"stop exited {stopped.returncode}: {stopped.stdout.strip()}")
            except OSError as error:
                diagnostic(f"stop failed: {error}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("resolve")
    run = commands.add_parser("run")
    run.add_argument("launcher")
    run.add_argument("--cwd", required=True)
    run.add_argument("--brief-file", required=True)
    run.add_argument("--model")
    run.add_argument("--effort")
    args = parser.parse_args()
    if args.command == "run":
        return run_job(args)
    try:
        launcher = configured_launcher()
    except (LauncherError, OSError, UnicodeError, ValueError, RuntimeError) as error:
        diagnostic(error)
        return 2
    if launcher is not None:
        print(launcher)
    return 0


if __name__ == "__main__":
    sys.exit(main())
